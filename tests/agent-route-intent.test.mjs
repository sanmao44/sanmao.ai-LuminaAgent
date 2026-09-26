import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const source = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const requireTs = createTsRequire(fileURLToPath(new URL('../lib', import.meta.url)));
const realSkills = requireTs('./skills');

function harness(options = {}) {
  const calls = [];
  const manageCalls = [];
  const images = [];
  const model = { id: 'test-chat', rawId: 'test-chat', displayName: 'Test', capabilities: [], kind: 'chat' };
  const imageModel = { ...model, id: 'test-image', rawId: 'test-image', kind: 'image', enabled: true, published: true, capabilities: ['generate'], providerId: 'test' };
  const provider = { id: 'test', name: 'Test', platform: 'openai', enabled: true };
  const runtime = { model, provider };
  const reply = (message) => ({ choices: [{ message }] });
  const noOp = async () => {};
  const mocks = {
    '@/lib/providers': {
      chatCompletion: async (_provider, _model, payload) => {
        calls.push(payload);
        return reply(options.reply?.(payload, calls.length) || { content: '已经完成。' });
      },
      chatCompletionStream: async () => { throw new Error('unexpected direct stream'); },
      generateImage: async (_provider, _model, args) => { images.push({ mode: 'generate', ...args }); return options.emptyImages ? [] : [{ url: '/test.png' }]; },
      editImage: async (_provider, _model, args) => { images.push({ mode: 'edit', ...args }); return [{ url: '/test.png' }]; },
      imageDownloadAuth: () => undefined,
    },
    '@/lib/store': {
      getRuntimeModel: async (_id, kind) => kind === 'image' ? { provider, model: imageModel } : runtime,
      getRuntimeImageGenerationModel: async () => ({ provider, model: imageModel }),
      getPublicState: async () => ({ settings: {}, models: [imageModel], providers: [provider] }),
    },
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/runtime-operation': { beginRuntimeRequest: async () => noOp, RuntimeDrainingError: class extends Error {} },
    '@/lib/generation-log': { startGenerationLog: async () => 'test', finishGenerationLog: noOp, appendGenerationLog: noOp },
    '@/lib/generation-persistence': { persistGenerationResult: async ({ images: result }) => ({ images: result }) },
    '@/lib/agent/progress': { beginAgentRun: async () => null, finishAgentRun: noOp, reportAgentProgress: noOp, agentToolProgress: () => null },
    '@/lib/reference-images': { referenceRecordsForLog: () => [] },
    '@/lib/web-search': { planSearch: () => ({ intent: { entities: [] }, queries: [] }) },
    '@/lib/native-web-search': { nativeSearchIsEnabled: () => false },
    '@/lib/mcp/store': { listMcpServers: () => [] },
    '@/lib/mcp/tools': { mcpServersForTurn: () => [], loadMcpToolRuntime: async () => ({ servers: [], tools: [] }), lazyMcpGroupKeywords: () => ({}) },
    '@/lib/mcp/client': {},
    '@/lib/mcp/audit': {},
    '@/lib/mcp/filesystem-policy': {},
    '@/lib/mcp/browser-downloads': {},
    '@/lib/mcp/catalog-remote': {},
    '@/lib/mcp/filesystem-roots': { listFilesystemRoots: () => [], listFilesystemWriteRoots: () => [] },
    '@/lib/mcp/admin': {
      runMcpManageAction: async (...args) => {
        manageCalls.push(args);
        return { result: { server: { name: 'Windows-MCP' } } };
      },
    },
    '@/lib/mcp/runtime-admin': {},
    '@/lib/agent/approval': { toolApprovalPolicy: () => 'ask', assessToolApproval: () => ({ required: false, blocked: false }) },
    '@/lib/skills': { ...realSkills, buildAgentSkillContext: () => ({ settings: { enabled: false }, skills: [], indexSection: '', toolHint: '' }) },
    '@/lib/skill-archive': {},
    '@/lib/data-paths': { resolveLocalDataDir: () => '/unused-test-data' },
    '@/lib/image-storage': {},
    '@/lib/artifacts': { isValidArtifactId: () => false },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id] || requireTs(id === '@/lib/tools' ? '@/lib/tools/index' : id), module, module.exports);
  return {
    calls, manageCalls, images,
    async post(messages, extra = {}) {
      const response = await module.exports.POST(new Request('http://localhost/api/agent', {
        method: 'POST',
        body: JSON.stringify({ messages, webMode: 'off', ...extra }),
      }));
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    },
  };
}

test('smart variant planning uses the isolated JSON-only route without tools', async () => {
  const agent = harness({ reply: () => ({ content: '{"categories":[],"variants":[]}' }) });
  const data = await agent.post([{ role: 'user', content: '按 sourceId 整理变体' }], {
    source: 'canvas', task: 'smart_variant_planning', deliverable: 'TEXT',
  });
  assert.equal(data.message, '{"categories":[],"variants":[]}');
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].tools, undefined);
  assert.match(agent.calls[0].messages[0].content, /只返回一个合法 JSON 对象/);
});

const history = [
  { role: 'user', content: '画个对牛弹琴的寓意图，9:16' },
  { role: 'assistant', content: '已生成图片。[本条实际图片产物：对牛弹琴，9:16]' },
  { role: 'user', content: '生成鲁迅在评论这张图的场景' },
  { role: 'assistant', content: '鲁迅站在书房评论画中场景。' },
];

test('fresh chat asks for the image subject without calling a model or image service', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: '出图' }]);
  assert.equal(data.deliverable, 'CLARIFY');
  assert.match(data.message, /什么画面/);
  assert.equal(agent.calls.length, 0);
  assert.equal(agent.images.length, 0);
});

test('bare image command uses this chat subject, ratio and actual reference despite prose-only model output', async () => {
  const agent = harness();
  const data = await agent.post([...history, { role: 'user', content: '出图', references: [{ id: 'ref', kind: 'image', name: '当前对话图片', url: 'data:image/png;base64,dGVzdA==' }] }]);
  assert.equal(agent.images.length, 1);
  assert.equal(agent.images[0].mode, 'edit');
  assert.match(agent.images[0].prompt, /鲁迅/);
  assert.equal(agent.images[0].aspectRatio, '9:16');
  assert.equal(data.images.length, 1);
});

test('valid inline tool calls are executed once with their original prompt', async () => {
  const agent = harness({ reply: (payload) => payload.tools ? { content: '<tool_call>{"name":"image_generate","arguments":{"prompt":"鲁迅在书房评论寓意图","aspectRatio":"9:16"}}</tool_call>' } : { content: '图片已完成。' } });
  const data = await agent.post([{ role: 'user', content: '生成鲁迅评论图画的场景' }]);
  assert.equal(agent.images.length, 1);
  assert.equal(agent.images[0].prompt, '鲁迅在书房评论寓意图');
  assert.equal(data.images.length, 1);
  assert.doesNotMatch(data.message, /tool_call/);
});

test('empty provider output never returns a successful-looking image caption', async () => {
  const agent = harness({ emptyImages: true });
  const data = await agent.post([{ role: 'user', content: '画一张书房图' }]);
  assert.equal(data.images.length, 0);
  assert.match(data.message, /图片未生成成功/);
  assert.doesNotMatch(data.message, /已经完成/);
});

test('a changed nonvisual topic does not silently resume an older image task', async () => {
  const agent = harness();
  const data = await agent.post([...history, { role: 'user', content: '写一封请假邮件' }, { role: 'assistant', content: '您好，我需要请假。' }, { role: 'user', content: '出图' }]);
  assert.equal(data.deliverable, 'CLARIFY');
  assert.equal(agent.images.length, 0);
});

test('filesystem success prose is rejected when no tool has executed', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: '把项目中的 INTJ.png 改名为 INTJ_极简风.png' }]);
  assert.match(data.message, /尚未执行/);
  assert.doesNotMatch(data.message, /已经完成/);
});

test('an accepted image plan is resolved semantically within this conversation', async () => {
  const agent = harness({ reply: (payload) => String(payload.messages[0]?.content).includes('只判断当前用户')
    ? { content: '{"deliverable":"IMAGE","confidence":"high","reason":"用户确认刚才的海报方案"}' }
    : { content: '已经完成。' } });
  const data = await agent.post([
    { role: 'user', content: '先构思一个太空书店的海报，9:16' },
    { role: 'assistant', content: '海报画面是月球书店，是否按这个生成？' },
    { role: 'user', content: '好的' },
  ]);
  assert.equal(data.images.length, 1);
  assert.match(agent.images[0].prompt, /太空书店/);
  assert.equal(agent.images[0].aspectRatio, '9:16');
});

test('asking about an image does not grant permission to generate another one', async () => {
  const agent = harness();
  const data = await agent.post([...history, { role: 'user', content: '鲁迅看到这张图会怎么说？' }]);
  assert.equal(data.images.length, 0);
  assert.equal(agent.images.length, 0);
  assert.ok(agent.calls.every((payload) => !(payload.tools || []).some((tool) => tool.function.name === 'image_generate')));
});

test('GitHub 地址后直接说“帮我安装”会执行安装，不会返回安装教程', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: 'https://github.com/CursorTouch/Windows-MCP\n\n帮我安装' }]);
  assert.match(data.message, /Windows-MCP.*已安装并接入/);
  assert.equal(agent.manageCalls.length, 1);
  assert.deepEqual(agent.manageCalls[0][0], {
    action: 'install_from_repo',
    repo: 'https://github.com/CursorTouch/Windows-MCP',
  });
  assert.equal(agent.manageCalls[0][1].authorizedGithubRepo, 'https://github.com/CursorTouch/Windows-MCP');
  assert.equal(agent.calls.length, 0, '明确仓库安装不需要先问模型');
});

test('GitHub 地址后紧跟“安装”也会执行安装', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: 'https://github.com/CursorTouch/Windows-MCP安装' }]);
  assert.match(data.message, /Windows-MCP.*已安装并接入/);
  assert.equal(agent.manageCalls.length, 1);
  assert.equal(agent.manageCalls[0][1].authorizedGithubRepo, 'https://github.com/CursorTouch/Windows-MCP');
  assert.equal(agent.calls.length, 0, '明确仓库安装不需要先问模型');
});

test('用户只发 GitHub 仓库地址也会直接安装', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: 'https://github.com/CursorTouch/Windows-MCP' }]);
  assert.match(data.message, /Windows-MCP.*已安装并接入/);
  assert.equal(agent.manageCalls.length, 1);
  assert.deepEqual(agent.manageCalls[0][0], {
    action: 'install_from_repo',
    repo: 'https://github.com/CursorTouch/Windows-MCP',
  });
  assert.equal(agent.manageCalls[0][1].authorizedGithubRepo, 'https://github.com/CursorTouch/Windows-MCP');
  assert.equal(agent.calls.length, 0, '仓库地址本身就是安装指令，不需要先问模型');
});

test('助手索要仓库地址后，用户只发 GitHub 地址也会直接安装', async () => {
  const agent = harness();
  const data = await agent.post([
    { role: 'assistant', content: '安装失败：请把 GitHub 仓库地址直接发给我，我只会安装你这次消息里提供的仓库。' },
    { role: 'user', content: 'https://github.com/CursorTouch/Windows-MCP' },
  ]);
  assert.match(data.message, /Windows-MCP.*已安装并接入/);
  assert.equal(agent.manageCalls.length, 1);
  assert.deepEqual(agent.manageCalls[0][0], {
    action: 'install_from_repo',
    repo: 'https://github.com/CursorTouch/Windows-MCP',
  });
  assert.equal(agent.calls.length, 0, '安装交接不需要再次询问模型');
});

test('用户先发仓库地址、助手介绍后，用户说“安装”也会直接安装', async () => {
  const agent = harness();
  const data = await agent.post([
    { role: 'user', content: 'https://github.com/CursorTouch/Windows-MCP' },
    { role: 'assistant', content: '这是 CursorTouch/Windows-MCP 的 GitHub 项目链接。你希望我帮你做什么？' },
    { role: 'user', content: '安装' },
  ]);
  assert.match(data.message, /Windows-MCP.*已安装并接入/);
  assert.equal(agent.manageCalls.length, 1);
  assert.deepEqual(agent.manageCalls[0][0], {
    action: 'install_from_repo',
    repo: 'https://github.com/CursorTouch/Windows-MCP',
  });
  assert.equal(agent.calls.length, 0, '地址与安装指令已经在同一上下文，不需要再次询问模型');
});

test('a configured image model mentioned in a status report never triggers generation', async () => {
  const agent = harness({ reply: (payload) => {
    if (String(payload.messages?.[0]?.content || '').includes('只判断当前用户')) {
      return { content: '{"mode":"execute","deliverable":"IMAGE","confidence":"high","reason":"错误升级"}' };
    }
    return { content: '已了解，你的默认生图模型已经设置。' };
  } });
  const data = await agent.post([
    { role: 'assistant', content: '请告诉我你想要什么。' },
    { role: 'user', content: '我的默认生图模型已经设置' },
  ]);
  assert.equal(data.images.length, 0);
  assert.equal(agent.images.length, 0);
  assert.equal(agent.calls.filter((payload) => String(payload.messages?.[0]?.content || '').includes('只判断当前用户')).length, 0);
});

test('server ignores a stale client IMAGE deliverable when the new instruction is not a command', async () => {
  const agent = harness({ reply: () => ({ content: '已了解当前配置。' }) });
  const data = await agent.post([
    { role: 'assistant', content: '上一轮图片已完成。' },
    { role: 'user', content: '我的默认生图模型已经设置' },
  ], {
    deliverable: 'IMAGE',
    intentReason: '上一轮图片任务',
  });
  assert.equal(data.images.length, 0);
  assert.equal(agent.images.length, 0);
});

test('colloquial image requests retain the discussed scene and override the old ratio', async () => {
  const agent = harness();
  const data = await agent.post([...history, { role: 'user', content: '出个图片看下，21:9' }]);
  assert.equal(data.images.length, 1);
  assert.match(agent.images[0].prompt, /鲁迅/);
  assert.equal(agent.images[0].aspectRatio, '21:9');
});

test('unresolved image references ask a question instead of generating a guessed image', async () => {
  const agent = harness();
  const data = await agent.post([{ role: 'user', content: '根据第一张图生成海报' }]);
  assert.equal(data.deliverable, 'CLARIFY');
  assert.equal(agent.images.length, 0);
  assert.match(data.message, /哪张图片/);
});

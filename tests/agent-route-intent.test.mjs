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
    '@/lib/mcp/admin': {},
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
    calls, images,
    async post(messages) {
      const response = await module.exports.POST(new Request('http://localhost/api/agent', {
        method: 'POST',
        body: JSON.stringify({ messages, webMode: 'off' }),
      }));
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    },
  };
}

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

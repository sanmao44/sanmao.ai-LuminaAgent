import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/agent-routing.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
// The routing module imports project files by alias; compile the two pure
// dependencies into one test module so this remains a fast unit test.
const intentSource = await readFile(new URL('../lib/agent-intent.ts', import.meta.url), 'utf8');
const webSource = await readFile(new URL('../lib/agent-web.ts', import.meta.url), 'utf8');
const intentCompiled = ts.transpileModule(intentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const webCompiled = ts.transpileModule(webSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const modules = { intent: { exports: {} }, web: { exports: {} } };
new Function('require', 'module', 'exports', intentCompiled)((id) => { if (id === '@/lib/agent-intent') return modules.intent.exports; throw new Error(id); }, modules.intent, modules.intent.exports);
new Function('require', 'module', 'exports', webCompiled)((id) => { if (id === '@/lib/agent-web') return modules.web.exports; throw new Error(id); }, modules.web, modules.web.exports);
const routingCompiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const routingModule = { exports: {} };
new Function('require', 'module', 'exports', routingCompiled)((id) => id === '@/lib/agent-intent' ? modules.intent.exports : modules.web.exports, routingModule, routingModule.exports);
const routing = routingModule.exports;

test('capability discovery is not limited to a list of application names', () => {
  for (const input of ['打开设备管理器', '打开辅助功能', '帮我启动陌生应用', '把音量调低', '查询仓库库存', '读取剪贴板']) {
    const decision = routing.classifyAgentRequest(input);
    assert.equal(routing.needsMcpCapabilityDiscovery(decision.intent.mode, input, false), true, input);
    assert.equal(routing.needsMcpCapabilityDiscovery(decision.intent.mode, input, true), false, input);
  }
  for (const input of ['怎么打开网络设置？', '你能打开辅助功能吗？', '解释 Windows 系统设置']) {
    assert.equal(routing.needsMcpCapabilityDiscovery(routing.classifyAgentRequest(input).intent.mode, input, false), false, input);
  }
});

test('chooses bounded artifact routes before generic text or visual nouns', () => {
  assert.equal(routing.classifyAgentRequest('做一份项目周报').route, 'word');
  assert.equal(routing.classifyAgentRequest('生成一个销售数据 Excel 表格').route, 'excel');
  assert.equal(routing.classifyAgentRequest('做一个产品介绍 PPT').route, 'ppt');
  assert.equal(routing.classifyAgentRequest('把这几份资料打包成 zip').route, 'archive');
  assert.equal(routing.classifyAgentRequest('生成海报文案').route, 'text');
  assert.equal(routing.classifyAgentRequest('生成一张海报').route, 'image');
});

test('compact plain turns stay out of every executable path', () => {
  const base = {
    isCanvasSource: false,
    isCanvasNodeExecution: false,
    isTextPolishTask: false,
    isReversePromptTask: false,
    isOneTakeVideoPromptTask: false,
    isCinematicDirectorTask: false,
    isSmartVariantPlanningTask: false,
    identityQuestion: false,
    needsWebSearch: false,
    browserAutomationRequest: false,
    filesystemRequest: false,
    imageGenerationRequest: false,
    fileGenerationRequest: false,
    artifactGenerationRequest: false,
    canvasPatchRequest: false,
    tools: { useMcp: false, useBrowserMcp: false, useFilesystemMcp: false, useSkills: false, useNativeWeb: false, useNativeArtifact: false, reason: 'chat' },
  };
  assert.equal(routing.canUseCompactPlainTurn(base), true);
  assert.equal(routing.canUseCompactPlainTurn({ ...base, needsWebSearch: true }), false);
  assert.equal(routing.canUseCompactPlainTurn({ ...base, imageGenerationRequest: true }), false);
  assert.equal(routing.canUseCompactPlainTurn({ ...base, tools: { ...base.tools, useMcp: true } }), false);
});

test('limits context and separates web intent from local execution', () => {
  const history = [{ role: 'user', content: '之前的项目是 SANMAO.AI' }, { role: 'assistant', content: '已记录' }];
  assert.equal(routing.classifyAgentRequest('继续', { messages: history }, { webMode: 'auto' }).contextNeed, 'required');
  assert.equal(routing.classifyAgentRequest('搜索浏览器自动化资料', {}, { webMode: 'auto' }).browserAutomation, false);
  assert.equal(routing.classifyAgentRequest('在浏览器里搜索商品并点击第一个结果', {}, { webMode: 'auto' }).route, 'browser');
});

test('reuses a supplied intent and keeps the newest prior turn for web follow-ups', () => {
  const supplied = routing.classifyAgentRequest('写一段产品文案', {}, { webMode: 'off' }).intent;
  const history = [{ role: 'user', content: 'OpenAI 最新 API 变更' }];
  const decision = routing.classifyAgentRequest('后来呢', { messages: history }, {
    webMode: 'auto',
    intent: supplied,
  });
  assert.equal(decision.intent, supplied);
  assert.equal(decision.web.shouldSearch, true);
  assert.match(decision.web.query, /OpenAI/);
});

test('gates MCP, skills and native web by the bounded route plan', () => {
  const chat = routing.classifyAgentRequest('什么是 Fast Browser Use？');
  assert.equal(chat.tools.useMcp, false);
  assert.equal(chat.tools.useSkills, false);
  assert.equal(chat.tools.useNativeWeb, false);

  const web = routing.classifyAgentRequest('搜索 GitHub 最新资料');
  assert.equal(web.tools.useMcp, false);
  assert.equal(web.tools.useNativeWeb, true);

  const browser = routing.classifyAgentRequest('在 GitHub 页面搜索 issue 并点击第一个结果');
  assert.equal(browser.tools.useMcp, true);
  assert.equal(browser.tools.useBrowserMcp, true);
  assert.equal(browser.tools.useNativeWeb, false);

  const skill = routing.classifyAgentRequest('按项目规范排查这个部署报错');
  assert.equal(skill.tools.useSkills, true);
});

test('routes current-information questions to native web without MCP', () => {
  for (const input of ['今天 AI 界有什么新闻？', '推送今日 AI 界新闻', '推送今日娱乐圈新闻']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'auto' });
    assert.equal(decision.route, 'web', input);
    assert.equal(decision.tools.useNativeWeb, true, input);
    assert.equal(decision.tools.useMcp, false, input);
    assert.equal(decision.tools.useBrowserMcp, false, input);
    assert.deepEqual(decision.policy, { lane: 'search', discoverMcp: false, allowMcp: false });
    assert.equal(routing.routeNeedsSemanticReview(decision), false);
  }
});

test('search policy respects offline settings and never promotes unknown requests to MCP', () => {
  for (const input of ['今天 AI 界有什么新闻？', '推送今日娱乐圈新闻']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'off' });
    assert.equal(decision.web.shouldSearch, false);
    assert.equal(decision.policy.allowMcp, false);
    assert.equal(decision.policy.discoverMcp, false);
  }
  const offline = routing.classifyAgentRequest('不要联网，解释今天这段新闻', {}, { webMode: 'always' });
  assert.equal(offline.web.shouldSearch, false);
  const action = routing.classifyAgentRequest('在浏览器里搜索商品并点击第一个结果');
  assert.equal(action.policy.lane, 'action');
  assert.equal(action.policy.allowMcp, true);
});

test('does not activate any executable route for capability questions', () => {
  for (const input of ['可以生图吗？', '能生成 PPT 吗？', '支持联网搜索吗？', 'MCP 能做什么？']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'always' });
    assert.equal(decision.route, 'chat', input);
    assert.equal(decision.needsTools, false, input);
    assert.equal(decision.tools.useMcp, false, input);
    assert.equal(decision.tools.useNativeWeb, false, input);
    assert.equal(decision.tools.useNativeArtifact, false, input);
  }
  assert.equal(routing.classifyAgentRequest('帮我生成一张猫的图片，可以吗？').route, 'image');
  assert.equal(routing.classifyAgentRequest('请做一个产品介绍 PPT').route, 'ppt');
});

test('does not reopen a high-confidence status report for semantic execution', () => {
  const decision = routing.classifyAgentRequest('我的默认生图模型已经设置', {
    messages: [{ role: 'assistant', content: '请告诉我你想要什么。' }],
  });
  assert.equal(decision.route, 'chat');
  assert.equal(decision.intent.confidence, 'high');
  assert.equal(decision.intent.mode, 'unknown');
  assert.equal(routing.routeNeedsSemanticReview(decision), false);
});

test('does not force semantic review when a route is unambiguous', () => {
  const decision = routing.classifyAgentRequest('生成一个 PPT 介绍方案');
  assert.equal(routing.routeNeedsSemanticReview(decision), false);
  assert.deepEqual(routing.selectAgentContextMessages([{ role: 'user', content: 'old' }], 'none'), []);
});

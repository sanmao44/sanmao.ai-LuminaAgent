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
const informationSource = await readFile(new URL('../packages/agent-core/information-routing.ts', import.meta.url), 'utf8');
const videoDownloadContractSource = await readFile(new URL('../packages/contracts/video-download.ts', import.meta.url), 'utf8');
const intentCompiled = ts.transpileModule(intentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const webCompiled = ts.transpileModule(webSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const informationCompiled = ts.transpileModule(informationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const videoDownloadContractCompiled = ts.transpileModule(videoDownloadContractSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const modules = { intent: { exports: {} }, web: { exports: {} }, information: { exports: {} } };
new Function('require', 'module', 'exports', intentCompiled)((id) => { if (id === '@/lib/agent-intent') return modules.intent.exports; throw new Error(id); }, modules.intent, modules.intent.exports);
const videoDownloadContract = { exports: {} };
new Function('require', 'module', 'exports', videoDownloadContractCompiled)(() => { throw new Error('Unexpected video download contract dependency'); }, videoDownloadContract, videoDownloadContract.exports);
new Function('require', 'module', 'exports', webCompiled)((id) => {
  if (id === '@/lib/agent-web') return modules.web.exports;
  if (id === '../packages/contracts/video-download') return videoDownloadContract.exports;
  throw new Error(id);
}, modules.web, modules.web.exports);
new Function('require', 'module', 'exports', informationCompiled)((id) => { if (id === '../contracts/planning') return {}; throw new Error(id); }, modules.information, modules.information.exports);
const routingCompiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const routingModule = { exports: {} };
new Function('require', 'module', 'exports', routingCompiled)((id) => id === '@/lib/agent-intent' ? modules.intent.exports : id === '@/lib/agent-web' ? modules.web.exports : modules.information.exports, routingModule, routingModule.exports);
const routing = routingModule.exports;

const skillRoutingSource = await readFile(new URL('../packages/agent-core/skill-routing.ts', import.meta.url), 'utf8');
const skillRoutingCompiled = ts.transpileModule(skillRoutingSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const skillRoutingModule = { exports: {} };
new Function('require', 'module', 'exports', skillRoutingCompiled)(() => ({}), skillRoutingModule, skillRoutingModule.exports);
const skillRouting = skillRoutingModule.exports;

const luxunSkill = { id: 'luxun-voice', name: 'luxun-voice', description: '用鲁迅口吻和鲁迅风格写作', tags: ['鲁迅', '口吻', '风格', '模仿'], enabled: true };

test('discovery resolution preserves policy while activating selected desktop tools', () => {
  for (const input of ['打开个性化', '打开网络设置', '打开设备管理器']) {
    const plan = routing.classifyAgentRequest(input);
    assert.equal(routing.resolveAgentToolPlan(plan, ['windows-test']).useMcp, true, input);
    assert.equal(routing.resolveAgentToolPlan(plan, []).useMcp, true, input);
    assert.equal(plan.tools.useMcp, true, 'explicit Windows controls activate MCP without mutating the resolved plan');
    assert.equal(plan.desktopAutomation, true, input);
  }
  for (const input of ['推送今日AI新闻', '今天有什么新闻？', '怎么打开网络设置？', '你能打开辅助功能吗？']) {
    const plan = routing.classifyAgentRequest(input);
    assert.equal(routing.resolveAgentToolPlan(plan, ['windows-test']).useMcp, false, input);
  }
});

test('explicit multi-step desktop command activates MCP but a capability question does not', () => {
  const command = routing.classifyAgentRequest('请打开记事本，在窗口里输入测试文字，然后截图核验');
  assert.equal(command.tools.useMcp, true);
  assert.equal(command.policy.allowMcp, true);
  const question = routing.classifyAgentRequest('你能在记事本里输入文字吗？');
  assert.equal(question.tools.useMcp, false);
  assert.equal(question.policy.allowMcp, false);
});

test('Windows system-control requests select desktop MCP and exclude browser automation', () => {
  const desktop = routing.classifyAgentRequest('打开防火墙');
  assert.equal(desktop.desktopAutomation, true);
  assert.equal(desktop.browserAutomation, false);
  assert.equal(desktop.tools.useMcp, true);
  assert.equal(desktop.tools.useBrowserMcp, false);
  assert.equal(desktop.policy.discoverMcp, true);

  const question = routing.classifyAgentRequest('怎么打开防火墙？');
  assert.equal(question.desktopAutomation, false);
  assert.equal(question.browserAutomation, false);
  assert.equal(question.tools.useMcp, false);
  assert.equal(routing.classifyAgentRequest('你能打开防火墙吗？').desktopAutomation, false);

  const browser = routing.classifyAgentRequest('在浏览器里搜索防火墙设置');
  assert.equal(browser.desktopAutomation, false);
  assert.equal(browser.browserAutomation, true);
  assert.equal(browser.tools.useBrowserMcp, true);
  assert.equal(routing.classifyAgentRequest('打开 bilibili').browserAutomation, true);
});

test('English browser commands select Browser MCP while questions and web search stay separate', () => {
  for (const input of ['Open bilibili', 'Please open bilibili', 'Visit example.com', 'Go to example.com', 'Navigate to example.com', 'Open https://example.com and click submit']) {
    const route = routing.classifyAgentRequest(input, {}, { webMode: 'auto' });
    assert.equal(route.route, 'browser', input);
    assert.equal(route.browserAutomation, true, input);
    assert.equal(route.tools.useBrowserMcp, true, input);
    assert.equal(route.tools.useNativeWeb, false, input);
  }

  for (const input of ['Can you open bilibili?', 'How do I open bilibili?', 'Should I visit example.com?']) {
    const route = routing.classifyAgentRequest(input, {}, { webMode: 'auto' });
    assert.equal(route.route, 'chat', input);
    assert.equal(route.tools.useMcp, false, input);
    assert.equal(route.tools.useBrowserMcp, false, input);
  }

  const search = routing.classifyAgentRequest('Search for the latest OpenAI API version', {}, { webMode: 'auto' });
  assert.equal(search.route, 'web');
  assert.equal(search.tools.useNativeWeb, true);
  assert.equal(search.tools.useBrowserMcp, false);
});

test('explicit browser action follow-ups inherit only a successful recent browser task', () => {
  const activeBrowserHistory = [
    { role: 'user', content: 'Open bilibili' },
    { role: 'assistant', content: 'Bilibili is open.' },
  ];
  const continuation = routing.classifyAgentRequest('Click the first video', { messages: activeBrowserHistory }, { webMode: 'off' });
  assert.equal(continuation.route, 'browser');
  assert.equal(continuation.browserAutomation, true);
  assert.equal(continuation.browserIntent.destination, 'bilibili');
  assert.equal(continuation.contextNeed, 'required');
  assert.equal(continuation.tools.useBrowserMcp, true);
  assert.equal(continuation.policy.allowMcp, true);
  const chineseContinuation = routing.classifyAgentRequest('点击第一个视频', { messages: activeBrowserHistory }, { webMode: 'off' });
  assert.equal(chineseContinuation.route, 'browser');
  assert.equal(chineseContinuation.tools.useBrowserMcp, true);

  const noContext = routing.classifyAgentRequest('Click the first video', {}, { webMode: 'off' });
  assert.equal(noContext.route, 'chat');
  assert.equal(noContext.tools.useBrowserMcp, false);
  assert.equal(routing.classifyAgentRequest('点击第一个视频', {}, { webMode: 'off' }).tools.useBrowserMcp, false);

  const failedHistory = [
    { role: 'user', content: 'Open bilibili' },
    { role: 'assistant', content: 'The browser navigation failed; the page was not opened.' },
  ];
  assert.equal(routing.classifyAgentRequest('Click the first video', { messages: failedHistory }, { webMode: 'off' }).tools.useBrowserMcp, false);

  const missingToolHistory = [
    { role: 'user', content: 'Open bilibili' },
    { role: 'assistant', content: '本次操作尚未执行，模型没有成功调用所需工具。请检查对应服务是否已启用、目录是否已授权，或切换支持工具调用的模型。' },
  ];
  assert.equal(routing.classifyAgentRequest('Click the first video', { messages: missingToolHistory }, { webMode: 'off' }).tools.useBrowserMcp, false);

  const searchHistory = [
    { role: 'user', content: 'Search for the latest OpenAI API version' },
    { role: 'assistant', content: 'Here are the latest results.' },
  ];
  assert.equal(routing.classifyAgentRequest('Click the first video', { messages: searchHistory }, { webMode: 'off' }).tools.useBrowserMcp, false);

  assert.equal(routing.classifyAgentRequest('Can you click the first video?', { messages: activeBrowserHistory }, { webMode: 'off' }).tools.useBrowserMcp, false);
});

test('shared request mode lets role-voice questions activate the matching skill', () => {
  for (const input of [
    '如果鲁迅能抽上电子烟他会怎么说',
    '鲁迅看到这张图会怎么说？',
  ]) {
    const requestMode = modules.intent.exports.inferAgentRequestMode(input);
    assert.equal(requestMode, 'execute', input);
    const route = skillRouting.routeSkillRequest(input, [luxunSkill], { requestMode });
    assert.equal(route.matched, true, input);
    assert.equal(route.skillId, 'luxun-voice', input);
  }

  const ordinaryQuestion = skillRouting.routeSkillRequest('今天有什么新闻？', [luxunSkill], { requestMode: 'ask' });
  assert.equal(ordinaryQuestion.matched, false);
});

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

test("read-only source tracing with a file-write prohibition stays out of the artifact lane", () => {
  const input = "请只读追踪这个问题：`update.json` 中 SHA-256 校验失败时，用户从界面触发更新，到下载校验失败并向用户显示错误的完整调用链在哪？请从 `update.json` 出发，在当前授权目录内进行追踪。优先使用正文搜索和带行号的原文读取工具。每个环节都给出相对路径:行号，并附能证明该环节的原文片段；核对 UI 触发、API 路由、预期 SHA-256 的取得、下载后的实际哈希计算与比较、失败信息返回链。只读；严禁写入文件或触发任何更新 API。";
  const decision = routing.classifyAgentRequest(input);

  assert.equal(modules.web.exports.likelyFileGenerationRequest(input), false);
  assert.equal(decision.filesystem, true);
  assert.equal(decision.artifactKind, "none");
  assert.equal(decision.route, "filesystem");
  assert.equal(decision.tools.useNativeArtifact, false);
});
test('routes concrete source-file evidence questions to the filesystem lane', () => {
  const decision = routing.classifyAgentRequest('update.json 里 sha256 校验失败的完整调用链在哪？给出文件路径、行号和对应代码原文');
  assert.equal(decision.intent.mode, 'execute');
  assert.equal(decision.filesystem, true);
  assert.equal(decision.route, 'filesystem');
  assert.equal(decision.tools.useFilesystemMcp, true);
});

test('explicit browser targets win over incidental file extensions in mixed requests', () => {
  const repositoryTask = routing.classifyAgentRequest('update.json 里 sha256 校验失败的完整调用链在哪？给出文件路径、行号和对应代码原文');
  assert.equal(repositoryTask.route, 'filesystem');
  assert.equal(repositoryTask.browserAutomation, false);

  const namedWebsite = routing.classifyAgentRequest('打开 GitHub 仓库并搜索 issue');
  assert.equal(namedWebsite.route, 'browser');
  assert.equal(namedWebsite.browserAutomation, true);

  const mixedLocalAndExternal = routing.classifyAgentRequest('检查 update.json，然后打开 https://example.com/foo.ts 并搜索 issue');
  assert.equal(mixedLocalAndExternal.filesystem, true);
  assert.equal(mixedLocalAndExternal.browserAutomation, true);
  assert.equal(mixedLocalAndExternal.route, 'browser');
  assert.equal(mixedLocalAndExternal.browserIntent.destination, 'https://example.com/foo.ts');
});

test("local project content and named remote project searches route separately", () => {
  const local = routing.classifyAgentRequest("请搜索项目里的 API Key 配置");
  const remote = routing.classifyAgentRequest("帮我搜索 GitHub 项目列表并说明查到什么", {}, { webMode: "off" });
  assert.equal(local.filesystem, true);
  assert.equal(remote.filesystem, false);
  assert.equal(remote.tools.useMcp, true);
});
test('local source inspection does not pick up incidental browser navigation verbs', () => {
  const decision = routing.classifyAgentRequest('只在授权代码库里工作，定位 update.json 的 SHA-256 校验调用链；进入实现后搜索并给出路径、行号和原文。');
  assert.equal(decision.filesystem, true);
  assert.equal(decision.route, 'filesystem');
  assert.equal(decision.browserAutomation, false);
  assert.equal(decision.tools.useBrowserMcp, false);
});

test('explicit command execution is distinct from filesystem discovery and command discussion', () => {
  for (const input of [
    '请在项目目录运行一次 npm run typecheck，贴出退出码。',
    '第 3 题第二轮：在只读隔离目录 C:\\Temp\\repo 中执行一次真实 `npm run typecheck`。',
    '跑一下 typecheck',
    '请在项目目录运行 npm test。',
  ]) {
    assert.equal(routing.isExplicitCommandExecutionRequest(input), true, input);
  }
  for (const input of [
    'update.json 里 sha256 校验失败的完整调用链在哪？给出文件路径和行号。',
    'typecheck 是什么？',
    '不要运行 npm run typecheck。',
    '怎么运行 npm run typecheck？',
  ]) {
    assert.equal(routing.isExplicitCommandExecutionRequest(input), false, input);
  }
  assert.equal(routing.isCommandExecutionToolName('filesystem-test__run_command'), true);
  assert.equal(routing.isCommandExecutionToolName('execute_project_command'), true);
  assert.equal(routing.isCommandExecutionToolName('run_shell_command'), true);
  assert.equal(routing.isCommandExecutionToolName('filesystem-test__read_text_file'), false);
  assert.equal(routing.isCommandExecutionToolName('windows-mcp__App'), false);
  assert.equal(routing.isExplicitProjectTypecheckRequest('跑一下 typecheck'), true);
  assert.equal(routing.isExplicitProjectTypecheckRequest('不要运行 typecheck'), false);
  assert.equal(routing.isExplicitProjectTypecheckRequest('不要修改任何文件后运行 typecheck'), true);
  assert.equal(routing.isExplicitProjectTypecheckRequest('先运行 typecheck，然后修复错误'), false);
  assert.equal(routing.isExplicitProjectTypecheckRequest('请使用受控命令执行器运行 npm run typecheck'), false);
});

test('keeps local file preview requests out of downloadable-file generation', () => {
  const prompt = '请在隔离夹具中把 C:\\Temp\\fixture\\qa-edit-target.txt 第一行的 `initial line` 改成 `corrected line`。本轮只做预览：使用本地文件编辑工具的 dry-run/预览能力，返回准确 diff，不要落盘，也不要调用真实写入。展示 diff 后停止并等待我明确确认。';
  const decision = routing.classifyAgentRequest(prompt);
  assert.equal(decision.intent.mode, 'execute');
  assert.equal(decision.filesystem, true);
  assert.equal(decision.route, 'filesystem');
  assert.equal(decision.artifactKind, 'none');
  assert.equal(decision.tools.useFilesystemMcp, true);
  assert.equal(decision.tools.useNativeArtifact, false);
});

test('routes a requested local edit with diff review without requiring tool names', () => {
  for (const prompt of [
    '请把 qa-edit-target.txt 里的 initial line 改成 corrected line，先生成可核对的 diff，等我确认后落盘。',
    '请把 qa-edit-target.txt 里的 initial line 替换为 corrected line，先返回 qa-edit-target.txt 的 diff，确认后再写入文件。',
    '帮我把 qa-edit-target.txt 里的 typo 改掉，先给 diff 让我确认，再落盘。',
    '请把 qa-edit-target.txt 里的错字改了，先生成可核对的 diff，等我确认再改。',
    '请修正 qa-edit-target.txt 的拼写，先返回 qa-edit-target.txt 的 diff，等我确认再改。',
  ]) {
    const decision = routing.classifyAgentRequest(prompt);
    assert.equal(decision.route, 'filesystem', prompt);
    assert.equal(decision.artifactKind, 'none', prompt);
    assert.equal(decision.tools.useFilesystemMcp, true, prompt);
    assert.equal(decision.tools.useNativeArtifact, false, prompt);
    assert.equal(modules.web.exports.likelyFileGenerationRequest(prompt), false, prompt);
  }
});

test('keeps explicit diff file delivery requests even when a local edit is also requested', () => {
  for (const prompt of [
    '请导出一份可下载的 diff 附件。',
    '请修改 qa-edit-target.txt，并另生成一个 change.diff 文件。',
    '请修改 qa-edit-target.txt，并生成差异报告文件。',
  ]) {
    assert.equal(modules.web.exports.likelyFileGenerationRequest(prompt), true, prompt);
  }
  const exportDiff = routing.classifyAgentRequest('请导出一份可下载的 diff 附件。');
  assert.equal(exportDiff.route, 'file');
  assert.equal(exportDiff.tools.useNativeArtifact, true);
});

test('negative file-delivery instructions do not activate artifact generation', () => {
  const prompt = '请在项目目录运行一次 npm run typecheck，贴出退出码、stdout 和 stderr，不要创建或下载任何文件。';
  const decision = routing.classifyAgentRequest(prompt);
  assert.equal(modules.web.exports.likelyFileGenerationRequest(prompt), false);
  assert.equal(modules.web.exports.likelyArtifactGenerationRequest(prompt), false);
  assert.equal(decision.filesystem, true);
  assert.equal(decision.route, 'filesystem');
  assert.equal(decision.artifactKind, 'none');
  assert.equal(decision.tools.useNativeArtifact, false);

  const prohibition = '不要创建或下载任何文件。';
  const prohibitionDecision = routing.classifyAgentRequest(prohibition);
  assert.equal(prohibitionDecision.artifactKind, 'none');
  assert.equal(prohibitionDecision.tools.useNativeArtifact, false);

  const q3RoundOne = '第 3 题第一轮：只在隔离只读仓库 C:\\Users\\wc103\\AppData\\Local\\Temp\\sanmao-agent-qa-20261125-015438\\repo 目录请求执行一次 `npm run typecheck`。请返回真实退出码、stdout 与 stderr；不要把猜测或模拟输出当结果，也不要修改任何文件。如果当前工具集没有受控命令执行器，请明确报告能力缺失并停止。';
  const q3RoundTwo = '第 3 题第二轮：在只读隔离目录 C:\\Users\\wc103\\AppData\\Local\\Temp\\sanmao-agent-qa-20261125-015438\\repo 中执行一次真实 `npm run typecheck`。这是命令执行能力测试，不是文档、浏览器或文件生成任务：不要创建或下载任何文件，不要调用文档工具，不要模拟结果。只返回执行器实际的退出码，以及分开的 stdout 和 stderr；如果工具清单没有受控 shell/命令执行器，就明确说“能力缺失”，不要改做别的任务。';
  for (const prompt of [q3RoundOne, q3RoundTwo]) {
    const request = routing.classifyAgentRequest(prompt);
    assert.equal(request.route, 'filesystem');
    assert.equal(request.filesystem, true);
    assert.equal(request.artifactKind, 'none');
    assert.equal(request.tools.useNativeArtifact, false);
  }

  const explicitDelivery = routing.classifyAgentRequest('请生成一个 Word 文档，另外不要下载任何文件。');
  assert.equal(explicitDelivery.route, 'word');
  assert.equal(explicitDelivery.tools.useNativeArtifact, true);
});
test('chooses bounded artifact routes before generic text or visual nouns', () => {
  assert.equal(routing.classifyAgentRequest('做一份项目周报').route, 'word');
  assert.equal(routing.classifyAgentRequest('生成一个销售数据 Excel 表格').route, 'excel');
  assert.equal(routing.classifyAgentRequest('做一个产品介绍 PPT').route, 'ppt');
  assert.equal(routing.classifyAgentRequest('把这几份资料打包成 zip').route, 'archive');
  assert.equal(routing.classifyAgentRequest('生成海报文案').route, 'text');
  assert.equal(routing.classifyAgentRequest('生成一张海报').route, 'image');
});

test('explicit HTML delivery selects the file route when the request also describes a visual scene', () => {
  const request = '画只鹅骑自行车的svg动画，html交付，带交互控件！';
  const decision = routing.classifyAgentRequest(request);
  assert.equal(modules.web.exports.likelyFileGenerationRequest(request), true);
  assert.equal(decision.route, 'file');
  assert.equal(decision.tools.useNativeArtifact, true);
  assert.equal(routing.routeDeliverable(decision.route, decision.intent.deliverable), 'TEXT');
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

  const skill = routing.classifyAgentRequest('按项目规范排查这个部署报错', {}, { skillRoute: { enabled: true, matched: true, explicit: false, confidence: 'high', skillId: 'project-debug', skillName: '项目调试', reason: 'test' } });
  assert.equal(skill.tools.useSkills, true);
});

test('new GitHub-to-Skill requests expose Skill installation without MCP or archive tools', () => {
  const request = '帮我把 https://github.com/yt-dlp/yt-dlp 做成 Skill，以后给视频链接就下载';
  const route = routing.classifyAgentRequest(request, {}, { webMode: 'auto' });
  assert.equal(route.tools.useSkills, true);
  assert.equal(route.tools.useMcp, false);
  assert.equal(route.tools.useBrowserMcp, false);
  assert.equal(route.tools.useNativeArtifact, false);
  assert.equal(route.policy.discoverMcp, false);
  assert.equal(route.needsTools, true);
});

test('技能路由按已安装技能元数据匹配自然语言，而不是依赖全局关键词', () => {
  const route = skillRouting.routeSkillRequest('用鲁迅的口吻赞美一位女生', [luxunSkill]);
  assert.equal(route.matched, true);
  assert.equal(route.skillId, 'luxun-voice');
  assert.equal(route.confidence, 'high');

  const ordinaryQuestion = skillRouting.routeSkillRequest('鲁迅看到这张图会怎么说？', [luxunSkill]);
  assert.equal(ordinaryQuestion.matched, false);
});

test('结构化技能选择优先于可见文本，不依赖前缀正则', () => {
  const route = skillRouting.routeSkillRequest('写段离职申请', [luxunSkill], { explicitSkillId: 'luxun-voice' });
  assert.equal(route.matched, true);
  assert.equal(route.explicit, true);
  assert.equal(route.skillId, 'luxun-voice');
});

test('GitHub repository data questions use read-only MCP instead of chat or native web', () => {
  for (const input of [
    '我的 GitHub 仓库有几个项目',
    '列出我的 GitHub 仓库',
    '看看这个仓库最近的 PR',
    '这个仓库最近有哪些 issue',
    '查看最近的 commit 和分支',
  ]) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'auto' });
    assert.equal(decision.tools.useMcp, true, input);
    assert.equal(decision.filesystem, false, input);
    assert.equal(decision.policy.allowMcp, true, input);
    assert.equal(decision.policy.discoverMcp, true, input);
    assert.equal(decision.tools.useNativeWeb, false, input);
  }

  const currentInfo = routing.classifyAgentRequest('搜索 GitHub 最新资料', {}, { webMode: 'auto' });
  assert.equal(currentInfo.tools.useMcp, false);
  assert.equal(currentInfo.tools.useNativeWeb, true);
});

test("GitHub project searches are not local Filesystem requests", () => {
  const decision = routing.classifyAgentRequest("帮我搜索 GitHub 项目列表并说明查到什么", {}, { webMode: "off" });
  assert.equal(decision.filesystem, false);
});
test('explicit skill selection takes priority over automatic web search', () => {
  for (const input of [
    '用「luxun-voice」技能：秋天到了，如果鲁迅在海南，他会怎么说',
    '用 luxun-voice 技能：秋天到了，如果鲁迅在海南，他会怎么说',
    '使用 luxun-voice 技能完成这段仿写',
  ]) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'always', skillRoute: { enabled: true, matched: false, explicit: true, confidence: 'high', skillId: 'luxun-voice', skillName: 'luxun-voice', reason: 'test explicit selection' } });
    assert.equal(decision.route, 'chat', input);
    assert.equal(decision.tools.useSkills, true, input);
    assert.equal(decision.needsTools, true, input);
    assert.equal(decision.tools.useNativeWeb, false, input);
    assert.equal(decision.web.shouldSearch, false, input);
    assert.equal(decision.policy.web, 'forbid', input);
  }

  const ordinaryQuestion = routing.classifyAgentRequest('秋天到了，如果鲁迅在海南，他会怎么说', {}, { webMode: 'auto' });
  assert.equal(ordinaryQuestion.route, 'web');
  assert.equal(ordinaryQuestion.tools.useSkills, false);
  assert.equal(ordinaryQuestion.tools.useNativeWeb, true);
});

test('未知站点的多步搜索和排序任务进入浏览器 MCP 路由', () => {
  const decision = routing.classifyAgentRequest('帮我打开光厂，搜索银河系，找到最多下载的哪个', {}, { webMode: 'auto' });
  assert.equal(decision.route, 'browser');
  assert.equal(decision.browserAutomation, true);
  assert.equal(decision.tools.useMcp, true);
  assert.equal(decision.tools.useBrowserMcp, true);
  assert.equal(decision.tools.useNativeWeb, false);
  assert.equal(decision.browserIntent.destination, '光厂');
  assert.deepEqual(decision.browserIntent.steps, ['navigate', 'inspect', 'search', 'select', 'sort']);
});

test('routes current-information questions to native web without MCP', () => {
  for (const input of ['今天 AI 界有什么新闻？', '推送今日 AI 界新闻', '推送今日娱乐圈新闻']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'auto' });
    assert.equal(decision.route, 'web', input);
    assert.equal(decision.tools.useNativeWeb, true, input);
    assert.equal(decision.tools.useMcp, false, input);
    assert.equal(decision.tools.useBrowserMcp, false, input);
    assert.deepEqual(decision.policy, { lane: 'search', web: 'require', discoverMcp: false, allowMcp: false });
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
  for (const input of ['可以生图吗？', '能生成 PPT 吗？', '支持联网搜索吗？', 'MCP 能做什么？', '你可以干啥？', '你能做什么？', '你会什么？']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'always' });
    assert.equal(decision.route, 'chat', input);
    assert.equal(decision.needsTools, false, input);
    assert.equal(decision.tools.useMcp, false, input);
    assert.equal(decision.tools.useNativeWeb, false, input);
    assert.equal(decision.tools.useNativeArtifact, false, input);
    assert.equal(decision.policy.web, 'forbid', input);
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

test('keeps pure greetings on the ordinary chat route', () => {
  for (const input of ['你好', '您好！', 'hello', '在吗？']) {
    const decision = routing.classifyAgentRequest(input);
    assert.equal(decision.route, 'chat', input);
    assert.equal(decision.needsTools, false, input);
  }
});

test('keeps colloquial capability questions out of search in every web mode', () => {
  for (const input of ['你可以干啥？', '你能干什么', '你会什么？', '你都能帮我做啥？']) {
    const decision = routing.classifyAgentRequest(input, {}, { webMode: 'always' });
    assert.equal(decision.route, 'chat', input);
    assert.equal(decision.web.shouldSearch, false, input);
    assert.equal(decision.policy.web, 'forbid', input);
  }
});

test('distinguishes internal capability freshness from external web freshness', () => {
  const capability = routing.classifyAgentRequest('你目前PPT创作能力如何？', {}, { webMode: 'always' });
  assert.equal(capability.information.source, 'internal-capability');
  assert.equal(capability.information.needsExternalWeb, false);
  assert.equal(capability.web.shouldSearch, false);
  assert.equal(capability.tools.useNativeWeb, false);

  const currentNews = routing.classifyAgentRequest('今天 AI 行业有什么新闻？', {}, { webMode: 'auto' });
  assert.equal(currentNews.information.source, 'external-web');
  assert.equal(currentNews.information.needsExternalWeb, true);
  assert.equal(currentNews.tools.useNativeWeb, true);

  const stableConcept = routing.classifyAgentRequest('什么是 MCP？', {}, { webMode: 'auto' });
  assert.equal(stableConcept.information.source, 'model-knowledge');
  assert.equal(stableConcept.web.shouldSearch, false);
});

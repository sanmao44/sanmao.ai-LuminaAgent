import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTsRequire } from './ts-require.mjs';

const requireTs = createTsRequire(fileURLToPath(new URL('../lib', import.meta.url)));
const realSkills = requireTs('./skills');
function harness(options = {}) {
  const calls = [];
  const discoveryCalls = [];
  const manageCalls = [];
  const images = [];
  const imageRuntimeRequests = [];
  const model = { id: 'test-chat', rawId: 'test-chat', displayName: 'Test', capabilities: [], kind: 'chat' };
  const imageModel = { ...model, id: 'test-image', rawId: 'test-image', kind: 'image', enabled: true, published: true, capabilities: options.imageCapabilities || ['generate'], providerId: 'test' };
  const provider = { id: 'test', name: 'Test', platform: 'openai', enabled: true };
  const runtime = { model, provider };
  const reply = (message) => ({ choices: [{ message }] });
  const noOp = async () => {};
  const mocks = {
    '@/apps/api/agent-composition': {
      AGENT_BROWSER_EXECUTION_LIMITS: { maxSteps: 8, maxCalls: 12, toolTimeMs: 120_000, deadlineMs: 180_000, recoveryPrompts: 2 },
      agentStripNativeSearchProcess: (text) => String(text || ''),
      createAgentApplicationInfrastructure: () => {
        const providerApi = mocks['@/lib/providers'];
        const storeApi = mocks['@/lib/store'];
        const persistenceApi = mocks['@/lib/generation-log'];
        const generationPersistenceApi = mocks['@/lib/generation-persistence'];
        const webApi = mocks['@/lib/web-search'];
        const nativeSearchApi = mocks['@/lib/native-web-search'];
        const mcpStoreApi = mocks['@/lib/mcp/store'];
        const mcpDiscoveryApi = mocks['@/lib/mcp/discovery'];
        const mcpToolsApi = mocks['@/lib/mcp/tools'];
        const mcpAdminApi = mocks['@/lib/mcp/admin'];
        const filesystemRootsApi = mocks['@/lib/mcp/filesystem-roots'];
        const skillsApi = mocks['@/lib/skills'];
        return {
          provider: {
            chatCompletion: providerApi.chatCompletion,
            chatCompletionStream: providerApi.chatCompletionStream,
            describeProviderFailure: providerApi.describeProviderFailure,
            editImage: providerApi.editImage,
            generateImage: providerApi.generateImage,
            imageDownloadAuth: providerApi.imageDownloadAuth,
          },
          artifacts: {
            collectArchiveEntries: async () => [],
            generateArchiveArtifact: async () => ({ files: [] }),
            generateDocumentArtifact: async () => ({ files: [] }),
            generatePresentationArtifact: async () => ({ files: [] }),
            generateSpreadsheetArtifact: async () => ({ files: [] }),
            isValidArtifactId: mocks['@/lib/artifacts'].isValidArtifactId,
            artifactDownloadUrl: (id) => `/api/artifacts/${id}`,
            getStorageRoots: () => [],
          },
          models: {
            getPublicState: storeApi.getPublicState,
            getRuntimeImageGenerationModel: storeApi.getRuntimeImageGenerationModel,
            getRuntimeImageModelCandidates: storeApi.getRuntimeImageModelCandidates,
            getRuntimeImageModelForCapability: storeApi.getRuntimeImageModelForCapability,
            getRuntimeModel: storeApi.getRuntimeModel,
            getRuntimeModelCandidates: async () => [runtime],
            filterModelsByActiveProviders: (models) => models,
            getProviderPreset: () => ({ label: 'Test' }),
          },
          persistence: {
            appendGenerationLog: persistenceApi.appendGenerationLog,
            finishGenerationLog: persistenceApi.finishGenerationLog,
            startGenerationLog: persistenceApi.startGenerationLog,
            persistGenerationResult: generationPersistenceApi.persistGenerationResult,
          },
          web: {
            planSearch: webApi.planSearch,
            searchWeb: async () => ({ query: '', intent: { entities: [] }, results: [], status: 'empty', resultCount: 0, rounds: 0 }),
          },
          mcp: {
            callMcpTool: async () => ({ ok: false, error: 'test MCP tool unavailable' }),
            MCP_CALL_TIMEOUT_MS: 30_000,
            MCP_TOOL_MAX_CALLS_PER_TURN: 8,
            MCP_TURN_TIME_BUDGET_MS: 120_000,
            MCP_TOOL_SEPARATOR: '__',
            lazyMcpGroupKeywords: mcpToolsApi.lazyMcpGroupKeywords,
            loadMcpToolRuntime: mcpToolsApi.loadMcpToolRuntime,
            mcpServersForTurn: mcpToolsApi.mcpServersForTurn,
            listMcpServers: mcpStoreApi.listMcpServers,
            BROWSER_TOOL_GUIDE: '',
            TABBIT_BROWSER_TOOL_GUIDE: '',
            BROWSER_EXECUTION_LIMITS: { maxSteps: 8, maxCalls: 12, toolTimeMs: 120_000, deadlineMs: 180_000, recoveryPrompts: 2 },
            browserExternalBlocker: () => '',
            browserTextNeedsContinuation: () => false,
            browserTextSubmissionGap: () => '',
            guardMcpServerCall: (_meta, args) => ({ ok: true, args }),
            importBrowserArtifacts: async () => [],
            shouldImportBrowserArtifacts: () => false,
            noteRemoteCatalogCallFailure: () => {},
            noteRemoteCatalogCallSuccess: () => {},
            listFilesystemRoots: filesystemRootsApi.listFilesystemRoots,
            listFilesystemWriteRoots: filesystemRootsApi.listFilesystemWriteRoots,
            recordMcpCall: () => {},
            summarizeMcpAuditText: (text) => String(text || '').slice(0, 200),
            runMcpManageAction: mcpAdminApi.runMcpManageAction,
            isMcpRuntimeAction: () => false,
            runMcpRuntimeAction: async () => ({ ok: false }),
            discoverMcpForRequest: mcpDiscoveryApi.discoverMcpForRequest,
          },
          browser: {
            isTabbitCliAvailable: () => false,
            runTabbitBrowserAction: async () => ({ ok: false, error: 'test browser unavailable' }),
          },
          filesystem: {
            persistImageBuffer: async () => null,
            importLocalImage: async () => null,
            isLocalImageRead: () => false,
            verifyFilesystemMove: async () => ({ ok: false }),
          },
          skills: {
            buildAgentSkillContext: skillsApi.buildAgentSkillContext,
            createCapabilityPorts: (dataDir) => ({
              maxCalls: skillsApi.SKILL_TOOL_MAX_CALLS,
              maxInstalls: skillsApi.SKILL_INSTALL_MAX_PER_REQUEST,
              searchSkills: (query, skills, limit) => skillsApi.searchSkills(query, [...skills], limit),
              readSkill: (id, options = {}) => skillsApi.readSkill(id, { ...options, dataDir }),
              readSkillFile: (id, file, options = {}) => skillsApi.readSkillFile(id, file, { ...options, dataDir }),
              recordSkillUsage: (id, options = {}) => { skillsApi.recordSkillUsage(id, { ...options, dataDir }); },
              buildSkillToolContent: (skill, file, offset) => skillsApi.buildSkillToolContent(skill, file, offset),
              installSkill: (input) => skillsApi.installSkill(input, { dataDir }),
              installSkillFromDocument: (input) => skillsApi.installSkillFromDocument(input, { dataDir }),
              fetchSkillText: (source, options) => skillsApi.fetchSkillText(source, options),
              parseGithubSkillTarget: (source) => skillsApi.parseGithubSkillTarget(source),
              fetchSkillFilesFromGithub: async () => { throw new Error('test GitHub skill adapter unavailable'); },
            }),
            SKILL_TOOL_MAX_CALLS: 8,
            stripToolCallMarkup: skillsApi.stripToolCallMarkup,
          },
          search: {
            nativeSearchIsEnabled: nativeSearchApi.nativeSearchIsEnabled,
            runNativeWebSearch: async () => ({ query: '', text: '', citations: [] }),
            stripNativeSearchProcess: (text) => String(text || ''),
          },
          data: { resolveLocalDataDir: () => '/unused-test-data' },
          health: {
            orderAgentModelCandidates: (candidates) => candidates,
            noteAgentModelSuccess: () => {},
            noteAgentModelFailure: () => {},
          },
        };
      },
      createAgentApplicationComposition: (options) => {
        const providerApi = mocks['@/lib/providers'];
        return {
          observer: { emit() {} },
          infrastructure: options.infrastructure,
          invokeChatModel: async (payload) => {
            const response = await providerApi.chatCompletion(options.candidates[0].provider, options.candidates[0].model.rawId, payload, options.signal);
            options.onCurrent?.(options.candidates[0]);
            return response;
          },
          invokeChatModelStream: async (payload) => providerApi.chatCompletionStream(options.candidates[0].provider, options.candidates[0].model.rawId, payload, options.signal),
          invokeSpecificChatModel: async (runtime, payload, signal) => providerApi.chatCompletion(runtime.provider, runtime.model.rawId, payload, signal),
          invokeCandidateChatModels: async (candidates, payload, signal) => providerApi.chatCompletion(candidates[0].provider, candidates[0].model.rawId, payload, signal),
        };
      },
    },
    '@/apps/api/agent-application-contract': {
      applicationJson: (body, options = {}) => ({ kind: 'json', body, ...(options.status === undefined ? {} : { status: options.status }) }),
      applicationStream: (body) => ({ kind: 'stream', body }),
    },
    '@/lib/providers': {
      chatCompletion: async (_provider, _model, payload) => {
        calls.push(payload);
        return reply(options.reply?.(payload, calls.length) || { content: '已经完成。' });
      },
      chatCompletionStream: async () => { throw new Error('unexpected direct stream'); },
      describeProviderFailure: () => 'provider failure',
      generateImage: async (_provider, _model, args) => { images.push({ mode: 'generate', ...args }); return options.emptyImages ? [] : [{ url: '/test.png' }]; },
      editImage: async (_provider, _model, args) => { images.push({ mode: 'edit', ...args }); return [{ url: '/test.png' }]; },
      imageDownloadAuth: () => undefined,
    },
    '@/lib/store': {
      getRuntimeModel: async (_id, kind) => kind === 'image' ? { provider, model: imageModel } : runtime,
      getRuntimeImageGenerationModel: async (id) => { imageRuntimeRequests.push({ capability: 'generate', id }); return { provider, model: imageModel }; },
      getRuntimeImageModelForCapability: async (_id, capability) => capability === 'edit' ? { provider, model: { ...imageModel, capabilities: ['edit'] } } : { provider, model: imageModel },
      getRuntimeImageModelCandidates: async () => [{ provider, model: imageModel }],
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
    '@/lib/mcp/store': { listMcpServers: () => options.mcpServers || [] },
    '@/lib/mcp/discovery': { discoverMcpForRequest: async () => { discoveryCalls.push(true); return { serverIds: (options.mcpServers || []).map((server) => server.id), unavailable: [] }; } },
    '@/lib/mcp/tools': { mcpServersForTurn: (servers) => servers, loadMcpToolRuntime: async () => ({ servers: options.mcpServers || [], tools: options.mcpTools || [] }), lazyMcpGroupKeywords: () => ({}) },
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
  const infrastructure = mocks['@/apps/api/agent-composition'].createAgentApplicationInfrastructure();
  const application = createTsRequire(process.cwd(), mocks)('./apps/api/agent-application');
  return {
    calls, discoveryCalls, manageCalls, images, imageRuntimeRequests,
    async post(messages, extra = {}) {
      const request = new Request('http://localhost/api/agent', {
        method: 'POST',
        body: JSON.stringify({ messages, webMode: 'off', ...extra }),
      });
      const output = await application.runAgentApplication({ body: await request.json(), signal: request.signal }, infrastructure);
      assert.equal(output.kind, 'json', 'harness covers non-stream behavior');
      const data = output.body;
      return data;
    },
  };
}

test('普通问答绕过语义规划和 MCP 能力发现', async () => {
  const agent = harness({
    mcpServers: [{ id: 'windows-test', name: 'windows-mcp', enabled: true, allowWrite: true }],
  });
  const data = await agent.post([{ role: 'user', content: '你可以做什么？' }]);
  assert.equal(agent.discoveryCalls.length, 0);
  assert.equal(agent.calls.length, 1);
  assert.equal(data.message, '已经完成。');
  assert.ok(agent.calls.every((call) => !String(call.messages?.[0]?.content || '').includes('只判断当前用户')));
});

test('纯问候仍调用当前选择的模型，不返回固定本地文案', async () => {
  const agent = harness({ reply: () => ({ content: '这是当前模型的专属问候。' }) });
  const data = await agent.post([{ role: 'user', content: '你好' }]);
  assert.equal(agent.calls.length, 1);
  assert.equal(data.message, '这是当前模型的专属问候。');
  assert.notEqual(data.message, '你好！有什么我可以帮你的吗？');
});

test('discovered desktop tools reach the model instead of the compact no-tools prompt', async () => {
  for (const content of ['打开个性化', '打开网络设置', '打开设备管理器']) {
    const agent = harness({
      mcpServers: [{ id: 'windows-test', name: 'windows-mcp', enabled: true, allowWrite: true, lazyLoad: true }],
      mcpTools: [{
        id: 'mcp:windows-test:App', name: 'windows-test__App', source: 'mcp',
        description: 'Open an application', schema: { type: 'object', properties: {} },
        tags: ['mcp'], risk: 'dangerous', permissions: ['process'], gating: () => true,
        mcp: { serverId: 'windows-test', serverName: 'windows-mcp', toolName: 'App', readOnly: false },
      }],
      reply: () => ({ content: '测试仅检查工具下发，不执行系统操作。' }),
    });
    await agent.post([{ role: 'user', content }]);
    assert.ok(agent.calls.some((call) => call.tools?.some((tool) => tool.function.name === 'windows-test__App')), content);
    assert.ok(agent.calls.every((call) => !call.messages[0].content.includes('当前请求不需要联网、图片、文件、浏览器、MCP')), content);
  }
});

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
  assert.equal(agent.images[0].mode, 'generate');
  assert.deepEqual(agent.images[0].references, ['data:image/png;base64,dGVzdA==']);
  assert.match(agent.images[0].prompt, /鲁迅/);
  assert.equal(agent.images[0].aspectRatio, '9:16');
  assert.equal(data.images.length, 1);
});

test('batch generation with a reference uses generate mode and shares the reference', async () => {
  const agent = harness({ reply: (payload) => payload.tools
    ? { content: '<tool_call>{"name":"image_edit","arguments":{"prompt":"模型错误的编辑调用"}}</tool_call>' }
    : { content: '套图已完成。' } });
  const data = await agent.post([
    { role: 'user', content: '商品详情图提示词：\n1. 正面白底展示，产品居中\n2. 侧面场景展示，突出材质', references: [
      { id: 'product', kind: 'image', name: '商品参考图', url: 'data:image/png;base64,dGVzdA==' },
      { id: 'prompts', kind: 'text', name: 'Agent 文本提示词', text: '1. 正面白底展示，产品居中\n2. 侧面场景展示，突出材质' },
    ] },
    { role: 'user', content: '套图', references: [
      { id: 'product', kind: 'image', name: '商品参考图', url: 'data:image/png;base64,dGVzdA==' },
      { id: 'prompts', kind: 'text', name: 'Agent 文本提示词', text: '1. 正面白底展示，产品居中\n2. 侧面场景展示，突出材质' },
    ] },
  ]);
  assert.equal(agent.images.length, 2);
  assert.ok(agent.images.every((image) => image.mode === 'generate'));
  assert.ok(agent.images.every((image) => image.references?.[0] === 'data:image/png;base64,dGVzdA=='));
  assert.equal(data.images.length, 2);
});

test('valid inline tool calls are executed once with their original prompt', async () => {
  const agent = harness({ reply: (payload) => payload.tools ? { content: '<tool_call>{"name":"image_generate","arguments":{"prompt":"鲁迅在书房评论寓意图","aspectRatio":"9:16"}}</tool_call>' } : { content: '图片已完成。' } });
  const data = await agent.post([{ role: 'user', content: '生成鲁迅评论图画的场景' }]);
  assert.equal(agent.images.length, 1);
  assert.equal(agent.images[0].prompt, '鲁迅在书房评论寓意图');
  assert.equal(data.images.length, 1);
  assert.doesNotMatch(data.message, /tool_call/);
});

test('language model cannot override the system default image model through tool arguments', async () => {
  const agent = harness({ reply: (payload) => payload.tools
    ? { content: '<tool_call>{"name":"image_generate","arguments":{"prompt":"系统默认模型测试","modelId":"language-model-picked"}}</tool_call>' }
    : { content: '图片已完成。' } });
  const data = await agent.post([{ role: 'user', content: '生成一张系统默认模型测试图' }]);
  assert.equal(agent.images.length, 1);
  assert.equal(data.images.length, 1);
  assert.equal(agent.images[0].prompt, '系统默认模型测试');
  assert.deepEqual(agent.imageRuntimeRequests, [{ capability: 'generate', id: 'auto' }]);
});

test('canvas image edit target overrides vague wording and reaches the edit capability', async () => {
  const agent = harness({ imageCapabilities: ['generate', 'edit'], reply: (payload) => payload.tools
    ? { content: '<tool_call>{"name":"image_generate","arguments":{"prompt":"背景换成深蓝色"}}</tool_call>' }
    : { content: '修改完成。' } });
  const data = await agent.post([{ role: 'user', content: '改一下，背景换成深蓝色', references: [{ id: 'image-1', nodeId: 'image-1', kind: 'image', name: '当前选中图片', url: 'data:image/png;base64,dGVzdA==' }] }], {
    source: 'canvas',
    executionMode: 'agent-dock',
    context: { schemaVersion: 1, creativeProjectId: 'creative-1', selectedNodeIds: ['image-1'], assetIds: [] },
    canvasTarget: { nodeIds: ['image-1'], kind: 'image', operation: 'edit' },
  });
  assert.equal(agent.images.length, 1);
  assert.equal(agent.images[0].mode, 'edit');
  assert.deepEqual(agent.images[0].references, ['data:image/png;base64,dGVzdA==']);
  assert.equal(data.images.length, 1);
});

test('client image model selection reaches Agent generation explicitly', async () => {
  const agent = harness({ reply: (payload) => payload.tools
    ? { content: '<tool_call>{"name":"image_generate","arguments":{"prompt":"客户端旧参数测试","modelId":"stale-client-model"}}</tool_call>' }
    : { content: '图片已完成。' } });
  const data = await agent.post([{ role: 'user', content: '生成一张客户端选择测试图' }], { imageModelId: 'test-image' });
  assert.equal(data.images.length, 1);
  assert.deepEqual(agent.imageRuntimeRequests, [{ capability: 'generate', id: 'test-image' }]);
});

test('承接上一轮编号生图方案时直接批量执行，不只回复生成计划', async () => {
  const agent = harness({ reply: () => ({ content: '开始生成图' }) });
  const data = await agent.post([
    { role: 'assistant', content: '我会一次批量生成 3 张：\n\n1. 高性能电动 SUV 在城市夜景中行驶，商业广告摄影\n2. SUV 前脸细节特写，冷光勾勒车身线条\n3. SUV 内部座舱展示，科技感与舒适氛围' },
    { role: 'user', content: '开始生成图' },
  ]);
  assert.equal(agent.images.length, 3);
  assert.deepEqual(agent.images.map((image) => image.prompt), [
    '高性能电动 SUV 在城市夜景中行驶，商业广告摄影',
    'SUV 前脸细节特写，冷光勾勒车身线条',
    'SUV 内部座舱展示，科技感与舒适氛围',
  ]);
  assert.equal(data.images.length, 3);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const capabilities = load('./packages/tool-runtime/native-capabilities');
const mcpCapabilities = load('./packages/tool-runtime/mcp-capability');
const artifacts = load('./lib/artifacts/index');
const artifactLimits = load('./lib/artifacts/limits');
const imageStorage = load('./lib/image-storage');
const artifactInfrastructure = {
  maxPerTurn: artifactLimits.ARTIFACT_MAX_PER_TURN,
  isValidArtifactId: artifacts.isValidArtifactId,
  getStorageRoots: imageStorage.getStorageRoots,
  generateDocumentArtifact: (input, options) => artifacts.generateDocumentArtifact(input, undefined, options),
  generateSpreadsheetArtifact: artifacts.generateSpreadsheetArtifact,
  generatePresentationArtifact: (input, options) => artifacts.generatePresentationArtifact(input, undefined, options),
  collectArchiveEntries: artifacts.collectArchiveEntries,
  generateArchiveArtifact: artifacts.generateArchiveArtifact,
};

test('native web capability returns bounded tool results and preserves search state', async () => {
  const result = await capabilities.executeWebCapability({
    callId: 'web-1',
    args: { query: 'sanmao' },
    signal: new AbortController().signal,
    searchWeb: async (query) => ({ query, results: [{ title: 'result' }] }),
    formatWebSearchContext: (value) => `context:${value.query}`,
  });
  assert.equal(result.webSearchData.query, 'sanmao');
  assert.equal(JSON.parse(result.message.content), 'context:sanmao');
});

test('native file capability normalizes multiple generated files through its port', () => {
  const result = capabilities.executeFileCapability({
    callId: 'file-1',
    args: { files: [{ name: 'a.txt' }, { name: 'b.txt' }] },
    signal: new AbortController().signal,
    normalizeGeneratedFile: (raw) => ({ name: raw.name, size: 4 }),
  });
  assert.equal(result.files.length, 2);
  assert.deepEqual(JSON.parse(result.message.content), { ok: true, count: 2, files: [{ name: 'a.txt', size: 4 }, { name: 'b.txt', size: 4 }] });
});

test('native canvas capability validates before returning an accepted patch', () => {
  const patch = { version: 1, operations: [{ op: 'remove_nodes', ids: ['node-1'] }] };
  const result = capabilities.executeCanvasCapability({
    callId: 'canvas-1',
    args: {},
    signal: new AbortController().signal,
    canvasDocument: { nodes: [{ id: 'node-1' }] },
    parseToolArguments: () => patch,
    validateCanvasPatch: (_document, candidate) => candidate.operations.length ? { ok: true } : { ok: false, error: 'empty' },
    runId: 'run-1',
  });
  assert.equal(result.canvasPatch.runId, 'run-1');
  assert.equal(JSON.parse(result.message.content).ok, true);
});

test('worker task control uses the worker-owned service boundary', async () => {
  const worker = load('./apps/worker/task-entry');
  let observed = 0;
  const result = await worker.runVideoTask('video-1', async (taskId) => {
    observed += 1;
    return { id: taskId, status: 'running' };
  }, { emit: async (event) => { assert.equal(event.kind, 'task'); } });
  assert.equal(observed, 1);
  assert.equal(result.status, 'running');
});

test('image capability normalizes ordered prompt batches at the runtime boundary', () => {
  const image = load('./packages/tool-runtime/image-capability');
  const result = image.normalizeImagePromptBatch({
    args: { prompts: [' first ', 'second', ''] },
    latestInstruction: '生成套图',
    fallbackImagePrompt: 'fallback',
    isBareImageExecution: () => false,
    extractBatchPrompts: () => [],
  });
  assert.deepEqual(result.prompts, ['first', 'second']);
  assert.equal(result.count, 1);
});

test('image capability returns the durable media log id when a provider accepts an async task', async () => {
  const image = load('./packages/tool-runtime/image-capability');
  const accepted = Object.assign(new Error('provider accepted'), {
    providerPossiblyAccepted: true,
    providerTaskId: 'provider-task-1',
  });
  const finished = [];
  const result = await image.executeImageCapability({
    state: { generated: [], batchItems: [], generations: [] },
    call: { id: 'image-pending-1', function: { name: 'image_generate' } },
    args: { prompt: 'a test image' },
    results: [],
    ports: {
      requestController: new AbortController(),
      imageToolsAllowed: true,
      isBareImageExecution: () => false,
      extractBatchPrompts: () => [],
      fallbackImagePrompt: 'fallback',
      requestedImageCapability: 'generate',
      latestRefs: [],
      trackedChatCompletion: async () => ({ choices: [{ message: { content: '' } }] }),
      agentRuntime: { provider: { name: 'chat' }, model: { rawId: 'chat-model' } },
      requestedAgentImageModelId: 'auto',
      imageModels: [{ id: 'image-model', capabilities: ['generate'] }],
      getRuntimeImageGenerationModel: async () => ({ provider: { name: 'image-provider' }, model: { id: 'image-model', rawId: 'image-raw', displayName: 'Image' } }),
      getRuntimeImageModelForCapability: async () => null,
      appendGenerationLog: async () => {},
      sourceForLog: 'canvas',
      taskContext: { taskId: 'agent-run-1' },
      startGenerationLog: async () => 'media-log-1',
      referenceRecords: [],
      getRuntimeImageModelCandidates: () => [],
      editImage: async () => [],
      generateImage: async () => { throw accepted; },
      persistGenerationResult: async () => ({ images: [] }),
      imageDownloadAuth: () => undefined,
      finishGenerationLog: async (id, patch) => { finished.push({ id, patch }); },
      latestInstruction: 'a test image',
      agentRunId: 'agent-run-1',
      skipCaption: true,
      executionPublicState: { settings: {} },
    },
  });
  const payload = JSON.parse(String(result.results[0].content));
  assert.equal(payload.pending, true);
  assert.equal(payload.generationTaskId, 'media-log-1');
  assert.equal(payload.mediaLogId, 'media-log-1');
  assert.equal(finished[0].id, 'media-log-1');
  assert.equal(finished[0].patch.providerTaskId, 'provider-task-1');
  assert.equal(finished[0].patch.taskId, 'agent-run-1');
});

test('Windows-MCP waits for a ready control state and recovers from repeated handoffs', async () => {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'cursortouch-windows-mcp', name: 'Windows MCP', url: 'stdio://windows-mcp', catalogId: 'windows-mcp', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'App', readOnly: false, blocked: false };
  const calls = [{ id: 'desktop-current' }, { id: 'desktop-following' }];
  let actionCalls = 0;
  let statusCalls = 0;
  const waits = [];
  const progress = [];
  const result = await mcpCapabilities.executeMcpCapability({
    state,
    call: calls[0],
    policy: { tool: { mcp: meta, risk: 'read' } },
    args: {},
    stepCalls: calls,
    callIndex: 0,
    requestController: new AbortController(),
    MCP_MANAGE_LABELS: {},
    isMcpRuntimeAction: () => false,
    runMcpRuntimeAction: async () => ({ result: {} }),
    runMcpManageAction: async () => ({ result: {} }),
    executionPublicState: { settings: {} },
    runTabbitBrowserAction: async () => ({ ok: true }),
    mcpToolCallLimit: 12,
    mcpTurnBudgetLimit: 60_000,
    browserMetrics: { record: () => '' },
    auditMcpCall: () => {},
    mcpServerById: new Map([[server.id, server]]),
    browserMutationBatches: new WeakSet(),
    mcpFilesystemRoots: [],
    persistImageBuffer: async () => ({ url: '' }),
    mcpRepeatTracker: new Map(),
    agentTurnStartedAt: Date.now(),
    ARTIFACT_MAX_PER_TURN: 10,
    appendPageContext: (_current, _source, text) => text,
    mcpCall: async (_targetServer, toolName) => {
      if (toolName === 'ControlStatus') {
        statusCalls += 1;
        const states = [
          { state: 'user', wait_seconds: 2 },
          { state: 'ready', wait_seconds: 0 },
          { state: 'user', wait_seconds: 1 },
          { state: 'ready', wait_seconds: 0 },
        ];
        return { isError: false, text: JSON.stringify(states[statusCalls - 1]) };
      }
      actionCalls += 1;
      if (actionCalls === 1) return { isError: true, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 7 } }) };
      if (actionCalls === 2) return { isError: true, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 4 } }) };
      return { isError: false, text: 'Device Manager launched' };
    },
    waitForMcpRetry: async (milliseconds) => { waits.push(milliseconds); },
    reportProgress: (patch) => progress.push(patch),
    mcpCallTimeoutMs: 10_000,
    importBrowserArtifacts: async () => ({ files: [], skipped: 0 }),
    shouldImportBrowserArtifacts: () => false,
    noteRemoteCatalogCallFailure: () => {},
    noteRemoteCatalogCallSuccess: () => {},
    importLocalImage: async () => ({ name: '', size: 0, url: '' }),
    isLocalImageRead: () => false,
    verifyFilesystemMove: async () => null,
    browserToolName: (name) => name,
    isBrowserMutationTool: () => false,
  });

  assert.equal(actionCalls, 3);
  assert.equal(statusCalls, 4);
  assert.deepEqual(waits, [7_000, 2_000, 4_000, 1_000]);
  assert.equal(state.mcpToolCallCount, 7);
  assert.equal(state.stalledMcpReason, '');
  assert.equal(result.stalled, undefined);
  assert.equal(result.results.length, 1);
  assert.match(JSON.parse(result.results[0].content).content, /Device Manager launched/);
  assert.ok(progress.some((patch) => /检查状态/.test(patch.message)));
});

test('Windows-MCP user-control retry respects call and time budgets and stops further calls', async () => {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 8_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'cursortouch-windows-mcp', name: 'Windows MCP', url: 'stdio://windows-mcp', catalogId: 'windows-mcp', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'App', readOnly: false, blocked: false };
  const calls = [{ id: 'desktop-current' }, { id: 'desktop-following' }];
  let invoked = 0;
  let waited = false;
  const result = await mcpCapabilities.executeMcpCapability({
    state,
    call: calls[0],
    policy: { tool: { mcp: meta, risk: 'write' } },
    args: { mode: 'launch', name: 'Device Manager' },
    stepCalls: calls,
    callIndex: 0,
    requestController: new AbortController(),
    MCP_MANAGE_LABELS: {},
    isMcpRuntimeAction: () => false,
    runMcpRuntimeAction: async () => ({ result: {} }),
    runMcpManageAction: async () => ({ result: {} }),
    executionPublicState: { settings: {} },
    runTabbitBrowserAction: async () => ({ ok: true }),
    mcpToolCallLimit: 1,
    mcpTurnBudgetLimit: 8_000,
    browserMetrics: { record: () => '' },
    auditMcpCall: () => {},
    mcpServerById: new Map([[server.id, server]]),
    browserMutationBatches: new WeakSet(),
    mcpFilesystemRoots: [],
    persistImageBuffer: async () => ({ url: '' }),
    mcpRepeatTracker: new Map(),
    agentTurnStartedAt: Date.now(),
    ARTIFACT_MAX_PER_TURN: 10,
    appendPageContext: (_current, _source, text) => text,
    reportProgress: () => {},
    mcpCall: async () => {
      invoked += 1;
      return { isError: true, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 7 } }) };
    },
    mcpCallTimeoutMs: 10_000,
    waitForMcpRetry: async () => { waited = true; },
    importBrowserArtifacts: async () => ({ files: [], skipped: 0 }),
    shouldImportBrowserArtifacts: () => false,
    noteRemoteCatalogCallFailure: () => {},
    noteRemoteCatalogCallSuccess: () => {},
    importLocalImage: async () => ({ name: '', size: 0, url: '' }),
    isLocalImageRead: () => false,
    verifyFilesystemMove: async () => null,
    browserToolName: (name) => name,
    isBrowserMutationTool: () => false,
  });

  assert.equal(invoked, 1);
  assert.equal(waited, false);
  assert.equal(result.stalled, true);
  assert.match(state.stalledMcpReason, /剩余时间或调用额度不足以安全等待重试/);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].tool_call_id, 'desktop-following');
});

test('successful Windows-MCP ControlStatus with user state is returned without stalling', async () => {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'cursortouch-windows-mcp', name: 'Windows MCP', url: 'stdio://windows-mcp', catalogId: 'windows-mcp', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'ControlStatus', readOnly: true, blocked: false };
  let waited = false;
  const result = await mcpCapabilities.executeMcpCapability({
    state,
    call: { id: 'desktop-status' },
    policy: { tool: { mcp: meta, risk: 'read' } },
    args: {},
    stepCalls: [{ id: 'desktop-status' }],
    callIndex: 0,
    requestController: new AbortController(),
    MCP_MANAGE_LABELS: {},
    isMcpRuntimeAction: () => false,
    runMcpRuntimeAction: async () => ({ result: {} }),
    runMcpManageAction: async () => ({ result: {} }),
    executionPublicState: { settings: {} },
    runTabbitBrowserAction: async () => ({ ok: true }),
    mcpToolCallLimit: 12,
    mcpTurnBudgetLimit: 60_000,
    browserMetrics: { record: () => '' },
    auditMcpCall: () => {},
    mcpServerById: new Map([[server.id, server]]),
    browserMutationBatches: new WeakSet(),
    mcpFilesystemRoots: [],
    persistImageBuffer: async () => ({ url: '' }),
    mcpRepeatTracker: new Map(),
    agentTurnStartedAt: Date.now(),
    ARTIFACT_MAX_PER_TURN: 10,
    appendPageContext: (_current, _source, text) => text,
    reportProgress: () => {},
    mcpCall: async () => ({ isError: false, text: JSON.stringify({ state: 'user', wait_seconds: 7 }) }),
    mcpCallTimeoutMs: 10_000,
    waitForMcpRetry: async () => { waited = true; },
    importBrowserArtifacts: async () => ({ files: [], skipped: 0 }),
    shouldImportBrowserArtifacts: () => false,
    noteRemoteCatalogCallFailure: () => {},
    noteRemoteCatalogCallSuccess: () => {},
    importLocalImage: async () => ({ name: '', size: 0, url: '' }),
    isLocalImageRead: () => false,
    verifyFilesystemMove: async () => null,
    browserToolName: (name) => name,
    isBrowserMutationTool: () => false,
  });

  assert.equal(result.stalled, undefined);
  assert.equal(state.stalledMcpReason, '');
  assert.equal(waited, false);
  assert.equal(JSON.parse(result.results[0].content).ok, true);
});

test('USER_CONTROL from an unrelated MCP does not trigger Windows desktop handoff behavior', async () => {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'other-mcp', name: 'Other MCP', url: 'stdio://other', catalogId: 'other', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'action', readOnly: false, blocked: false };
  const result = await mcpCapabilities.executeMcpCapability({
    state,
    call: { id: 'other-control' },
    policy: { tool: { mcp: meta, risk: 'write' } },
    args: {},
    stepCalls: [{ id: 'other-control' }],
    callIndex: 0,
    requestController: new AbortController(),
    MCP_MANAGE_LABELS: {},
    isMcpRuntimeAction: () => false,
    runMcpRuntimeAction: async () => ({ result: {} }),
    runMcpManageAction: async () => ({ result: {} }),
    executionPublicState: { settings: {} },
    runTabbitBrowserAction: async () => ({ ok: true }),
    mcpToolCallLimit: 12,
    mcpTurnBudgetLimit: 60_000,
    browserMetrics: { record: () => '' },
    auditMcpCall: () => {},
    mcpServerById: new Map([[server.id, server]]),
    browserMutationBatches: new WeakSet(),
    mcpFilesystemRoots: [],
    persistImageBuffer: async () => ({ url: '' }),
    mcpRepeatTracker: new Map(),
    agentTurnStartedAt: Date.now(),
    ARTIFACT_MAX_PER_TURN: 10,
    appendPageContext: (_current, _source, text) => text,
    reportProgress: () => {},
    mcpCall: async () => ({ isError: false, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 7 } }) }),
    mcpCallTimeoutMs: 10_000,
    importBrowserArtifacts: async () => ({ files: [], skipped: 0 }),
    shouldImportBrowserArtifacts: () => false,
    noteRemoteCatalogCallFailure: () => {},
    noteRemoteCatalogCallSuccess: () => {},
    importLocalImage: async () => ({ name: '', size: 0, url: '' }),
    isLocalImageRead: () => false,
    verifyFilesystemMove: async () => null,
    browserToolName: (name) => name,
    isBrowserMutationTool: () => false,
  });

  assert.equal(result.stalled, undefined);
  assert.equal(state.stalledMcpReason, '');
  assert.equal(result.results.length, 1);
});

test('Windows-MCP user-control parser accepts normalized markers and bounds wait time', () => {
  assert.equal(mcpCapabilities.windowsMcpUserControlWaitSeconds('USERCONTROL'), 10);
  assert.equal(mcpCapabilities.windowsMcpUserControlWaitSeconds('{"state":"user","wait_seconds":500}'), 120);
  assert.equal(mcpCapabilities.windowsMcpUserControlWaitSeconds('{"code":"TAKEOVER_PENDING","status":{"state":"takeover_pending"}}'), 1);
  assert.equal(mcpCapabilities.windowsMcpUserControlWaitSeconds('ordinary desktop result'), null);
});


test('artifact capability executes through its runtime port and returns metadata only', async () => {
  const { executeArtifactCapability } = load('./packages/tool-runtime/artifact-capability');
  const state = { generatedFiles: [], generatedArtifactCount: 0 };
  const result = await executeArtifactCapability({ state, call: { id: 'artifact-1', function: { name: 'document_generate' } }, args: { filename: 'part-b-runtime-contract.docx', markdown: '# Runtime contract' }, signal: new AbortController().signal, infrastructure: artifactInfrastructure });
  const payload = JSON.parse(String(result.content));
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.file.artifactId, 'string');
  assert.equal('content' in payload.file, false);
  assert.equal(state.generatedFiles.length, 1);
});

test('skill capability executes search through the runtime port', async () => {
  const { executeSkillCapability } = load('./packages/tool-runtime/skill-capability');
  const state = { generatedFiles: [], generatedArtifactCount: 0, skillToolCalls: 0, skillInstalls: 0, usedSkills: [] };
  const skill = load('./lib/skills');
  const skillArchive = load('./lib/skill-archive');
  const result = await executeSkillCapability({ state, call: { id: 'skill-1', function: { name: 'skill_search' } }, args: { query: 'runtime' }, skillContext: { settings: { enabled: true, autoApprove: false }, skills: [{ id: 'runtime', name: 'Runtime', description: 'runtime guidance', tags: ['runtime'], body: 'body', enabled: true }], pending: [], indexSection: '', toolHint: '' }, signal: new AbortController().signal, installer: { kind: 'agent', name: 'test', detail: 'test' }, parseToolArguments: () => ({}), skillPorts: { maxCalls: skill.SKILL_TOOL_MAX_CALLS, maxInstalls: skill.SKILL_INSTALL_MAX_PER_REQUEST, buildSkillToolContent: skill.buildSkillToolContent, installSkill: skill.installSkill, installSkillFromDocument: skill.installSkillFromDocument, readSkill: skill.readSkill, readSkillFile: skill.readSkillFile, recordSkillUsage: skill.recordSkillUsage, searchSkills: skill.searchSkills, fetchSkillText: skill.fetchSkillText, parseGithubSkillTarget: skill.parseGithubSkillTarget, fetchSkillFilesFromGithub: skillArchive.fetchSkillFilesFromGithub } });
  const payload = JSON.parse(String(result.content));
  assert.equal(payload.ok, true);
  assert.equal(payload.skills[0].id, 'runtime');
  assert.equal(state.skillToolCalls, 1);
});

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const capabilities = load('./packages/tool-runtime/native-capabilities');
const mcpCapabilities = load('./packages/tool-runtime/mcp-capability');
const AgentMcpDetailDock = load('./components/AgentMcpDetailDock').default;
const CreativeReviewPanel = load('./components/CreativeReviewPanel').default;
const { isCreativeReviewReport } = load('./packages/contracts/creative-review');
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

test('Tabbit page scripts enter the request-local browser freshness history without retaining source code', async () => {
  const state = {
    mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [], recentPageText: '',
  };
  const result = await mcpCapabilities.executeTabbitCapability({
    state,
    call: { id: 'tabbit-script' },
    args: { action: 'nodejs', requestId: 'script-1', code: 'await page.click("button")', readOnly: false },
    policy: { tool: { risk: 'external_side_effect' } },
    requestController: new AbortController(),
    mcpToolCallLimit: 12,
    agentRunId: 'agent-run-test',
    runTabbitBrowserAction: async () => ({ ok: true, response: { result: 'clicked' } }),
    browserMetrics: { record: (_name, _ok, text) => text },
    appendPageContext: (_current, _source, text) => text,
    auditMcpCall: () => {},
  });

  assert.equal(result.results.length, 1);
  assert.deepEqual(state.browserUses, [{
    name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: false },
  }]);
  assert.equal(JSON.stringify(state.browserUses).includes('page.click'), false);

  const failedState = { ...state, mcpToolCallCount: 0, browserUses: [], usedMcpTools: [] };
  await mcpCapabilities.executeTabbitCapability({
    state: failedState,
    call: { id: 'tabbit-script-timeout' },
    args: { action: 'nodejs', requestId: 'script-timeout', code: 'await page.click("button")', readOnly: false },
    policy: { tool: { risk: 'external_side_effect' } },
    requestController: new AbortController(),
    mcpToolCallLimit: 12,
    agentRunId: 'agent-run-test',
    runTabbitBrowserAction: async () => { throw new Error('execution timed out'); },
    browserMetrics: { record: (_name, _ok, text) => text },
    appendPageContext: (_current, _source, text) => text,
    auditMcpCall: () => {},
  });
  assert.deepEqual(failedState.browserUses, [{
    name: 'tabbit_browser', ok: false, args: { action: 'nodejs', readOnly: false },
  }], 'a timeout may happen after the page action took effect');
});

test('Tabbit read-only scripts retain only bounded result evidence for submission verification', async () => {
  const state = {
    mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [], recentPageText: '',
  };
  const source = 'sensitive-script-source';
  await mcpCapabilities.executeTabbitCapability({
    state,
    call: { id: 'tabbit-observation' },
    args: { action: 'nodejs', requestId: 'observe-1', code: source, readOnly: true },
    policy: { tool: { risk: 'read' } },
    requestController: new AbortController(),
    mcpToolCallLimit: 12,
    agentRunId: 'agent-run-test',
    runTabbitBrowserAction: async () => ({ ok: true, response: { comments: [{ text: 'requested phrase' }], pageText: 'x'.repeat(20_000) } }),
    browserMetrics: { record: (_name, _ok, text) => text },
    appendPageContext: (_current, _source, text) => text,
    auditMcpCall: () => {},
  });

  assert.equal(state.browserUses.length, 1);
  assert.equal(state.browserUses[0].args.readOnly, true);
  assert.ok(state.browserUses[0].result.length <= 16_000, 'stored evidence is bounded');
  assert.ok(state.browserUses[0].result.includes('requested phrase'));
  assert.equal(JSON.stringify(state.browserUses).includes(source), false, 'script source is never retained');
});

test('Tabbit comment stage is request-local metadata and is not forwarded to the browser CLI', async () => {
  const state = {
    mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [], recentPageText: '',
  };
  let receivedArgs;
  await mcpCapabilities.executeTabbitCapability({
    state,
    call: { id: 'tabbit-comment-fill' },
    args: { action: 'nodejs', requestId: 'fill-1', code: 'await page.locator("textarea").fill("reply")', readOnly: false, commentStage: 'fill' },
    policy: { tool: { risk: 'external_side_effect' } },
    requestController: new AbortController(),
    mcpToolCallLimit: 12,
    agentRunId: 'agent-run-test',
    runTabbitBrowserAction: async (args) => { receivedArgs = args; return { ok: true, response: { result: 'filled' } }; },
    browserMetrics: { record: (_name, _ok, text) => text },
    appendPageContext: (_current, _source, text) => text,
    auditMcpCall: () => {},
  });

  assert.equal(receivedArgs.commentStage, undefined, 'only supported CLI arguments cross the adapter');
  assert.equal(state.browserUses[0].args.commentStage, 'fill', 'the application retains the explicit action phase');
});

function createWindowsMcpTestContext({ mcpCall, waitForMcpRetry = async () => {}, mcpCallTimeoutMs = 10_000 }) {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'cursortouch-windows-mcp', name: 'Windows MCP', url: 'stdio://windows-mcp', catalogId: 'windows-mcp', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'App', readOnly: false, blocked: false };
  const input = {
    state,
    call: { id: 'desktop-current' },
    policy: { tool: { mcp: meta, risk: 'write' } },
    args: { mode: 'launch', name: 'Device Manager' },
    stepCalls: [{ id: 'desktop-current' }, { id: 'desktop-following' }],
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
    mcpCall,
    mcpCallTimeoutMs,
    waitForMcpRetry,
    importBrowserArtifacts: async () => ({ files: [], skipped: 0 }),
    shouldImportBrowserArtifacts: () => false,
    noteRemoteCatalogCallFailure: () => {},
    noteRemoteCatalogCallSuccess: () => {},
    importLocalImage: async () => ({ name: '', size: 0, url: '' }),
    isLocalImageRead: () => false,
    verifyFilesystemMove: async () => null,
    browserToolName: (name) => name,
    isBrowserMutationTool: () => false,
  };
  return { state, input };
}

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

test('reference image generation submits selected images through the provider image-input port', async () => {
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
      requestedImageCapability: 'reference',
      latestRefs: [{ kind: 'image', url: 'data:image/png;base64,reference' }],
      trackedChatCompletion: async () => ({ choices: [{ message: { content: '' } }] }),
      agentRuntime: { provider: { name: 'chat' }, model: { rawId: 'chat-model' } },
      requestedAgentImageModelId: 'auto',
      getRuntimeImageGenerationModel: async () => { throw new Error('reference work must use the reference capability lookup'); },
      getRuntimeImageModelForCapability: async (_id, capability) => {
        assert.equal(capability, 'reference');
        return { provider: { name: 'image-provider' }, model: { id: 'image-model', rawId: 'image-raw', displayName: 'Image' } };
      },
      appendGenerationLog: async () => {},
      sourceForLog: 'canvas',
      taskContext: { taskId: 'agent-run-1' },
      startGenerationLog: async (log) => { finished.push({ started: log }); return 'media-log-1'; },
      referenceRecords: [],
      getRuntimeImageModelCandidates: () => [],
      editImage: async () => { throw new Error('reference generation must not be classified as edit'); },
      generateImageWithReferences: async (_provider, _model, input) => {
        assert.deepEqual(input.references, ['data:image/png;base64,reference']);
        assert.equal(input.prompt, 'a test image');
        throw accepted;
      },
      generateImage: async () => { throw new Error('reference generation must use the provider image-input port'); },
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
  assert.equal(finished[0].started.operation, 'reference-generate');
  assert.equal(finished[1].id, 'media-log-1');
  assert.equal(finished[1].patch.providerTaskId, 'provider-task-1');
  assert.equal(finished[1].patch.taskId, 'agent-run-1');
  assert.equal(finished[1].patch.mode, 'generate');
  assert.equal(finished[1].patch.operation, 'reference-generate');
});

test('image generation returns its structured creative review to the Agent', async () => {
  const image = load('./packages/tool-runtime/image-capability');
  const artifactRefs = ['/api/storage/file?name=generated-1.png', '/api/storage/file?name=generated-2.png'];
  const generated = [];
  let persistedReview;
  const review = {
    version: 'p1', mediaKind: 'image', artifactRef: artifactRefs[0], checkedAt: '2026-11-26T00:00:00.000Z',
    capability: { status: 'fail', evidence: [
      { dimension: 'requested_aspect_ratio', status: 'fail', criterion: '2% tolerance', observed: '1:1', expected: '16:9', reason: 'ratio mismatch', source: 'rule' },
      { dimension: 'image_decode', status: 'pass', criterion: 'image decodes', observed: true, reason: 'decoded', source: 'rule' },
    ] },
    safety: { status: 'unknown', evidence: [{ dimension: 'content_safety', status: 'unknown', criterion: 'calibrated review required', reason: 'not calibrated', source: 'vision' }] },
  };
  const result = await image.executeImageCapability({
    state: { generated, batchItems: [], generations: [] },
    call: { id: 'image-review-1', function: { name: 'image_generate' } },
    args: { prompt: 'coffee product photo' },
    results: [],
    ports: {
      requestController: new AbortController(), imageToolsAllowed: true,
      isBareImageExecution: () => false, extractBatchPrompts: () => [], fallbackImagePrompt: 'fallback',
      latestRefs: [], trackedChatCompletion: async () => ({ choices: [{ message: { content: '' } }] }),
      agentRuntime: { provider: { name: 'chat' }, model: { rawId: 'chat-model' } },
      requestedAgentImageModelId: 'auto',
      getRuntimeImageGenerationModel: async () => ({ provider: { name: 'image-provider' }, model: { id: 'image-model', rawId: 'image-raw', displayName: 'Image' } }),
      getRuntimeImageModelForCapability: async () => null,
      appendGenerationLog: async () => {}, sourceForLog: 'agent', taskContext: {},
      startGenerationLog: async () => 'media-log-1', referenceRecords: [],
      getRuntimeImageModelCandidates: () => [], editImage: async () => [],
      generateImage: async () => [{ url: 'data:image/png;base64,ZmFrZTE=' }, { url: 'data:image/png;base64,ZmFrZTI=' }],
      persistGenerationResult: async () => ({ images: artifactRefs.map((url) => ({ url })) }),
      reviewImageArtifact: async (input) => { assert.ok(artifactRefs.includes(input.artifactRef)); assert.equal(input.brief, '请生成 16:9 咖啡广告图'); assert.equal(input.generationPrompt, 'coffee product photo'); return { ...review, artifactRef: input.artifactRef }; },
      imageDownloadAuth: () => undefined, finishGenerationLog: async (_id, patch) => { persistedReview = patch.creativeReview; }, skipCaption: true,
      latestInstruction: '请生成 16:9 咖啡广告图',
      executionPublicState: { settings: { imageStoragePath: 'C:\authorized-images' } },
    },
  });
  const payload = JSON.parse(String(result.results[0].content));
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.images.map((image) => image.ref), artifactRefs);
  assert.deepEqual(payload.creativeReviewFindings.map((entry) => entry.artifactRef), artifactRefs);
  assert.deepEqual(payload.creativeReviewFindings[0].findings.map((item) => item.dimension), ['requested_aspect_ratio']);
  assert.ok(payload.creativeReviewFindings.every((entry) => entry.findings.every((item) => item.status === 'fail')), 'pass evidence is also omitted from the model-facing tool result');
  assert.equal(JSON.stringify(payload.creativeReviewFindings).includes('unknown'), false, 'unknown evidence stays out of the model-facing tool result');
  assert.deepEqual(generated.map((image) => image.creativeReview.artifactRef), artifactRefs, 'the Agent response images keep each matching full review');
  assert.equal(generated.every((image) => isCreativeReviewReport(image.creativeReview)), true, 'image metadata remains valid under the existing report contract');
  assert.equal(generated[0].creativeReview.safety.evidence[0].status, 'unknown', 'the full image report retains inconclusive evidence for the UI filter');
  const unknownOnlyPanel = renderToStaticMarkup(createElement(CreativeReviewPanel, { reports: [{
    ...review,
    capability: { status: 'unknown', evidence: [{ dimension: 'brief_visual_compliance', status: 'unknown', criterion: 'visual review required', reason: 'not assessed', source: 'vision' }] },
  }] }));
  assert.equal(unknownOnlyPanel, '', 'unknown-only reports render no issue panel');
  assert.deepEqual(persistedReview.map((report) => report.artifactRef), artifactRefs);
  assert.equal(persistedReview[0].safety.evidence[0].status, 'unknown', 'the internal generation log keeps the complete report');
});

test('image generation keeps non-failing creative reviews internal', async () => {
  const image = load('./packages/tool-runtime/image-capability');
  const artifactRef = '/api/storage/file?name=generated-summary.png';
  const generated = [];
  let persistedReview;
  const review = {
    version: 'p1', mediaKind: 'image', artifactRef, checkedAt: '2026-11-26T00:00:00.000Z',
    capability: { status: 'pass', evidence: [{ dimension: 'image_decode', status: 'pass', criterion: 'image decodes', observed: true, reason: 'decoded', source: 'rule' }] },
    safety: { status: 'unknown', evidence: [{ dimension: 'content_safety', status: 'unknown', criterion: 'calibrated review required', reason: 'not calibrated', source: 'vision' }] },
  };
  const result = await image.executeImageCapability({
    state: { generated, batchItems: [], generations: [] },
    call: { id: 'image-review-summary-1', function: { name: 'image_generate' } },
    args: { prompt: 'coffee product photo' },
    results: [],
    ports: {
      requestController: new AbortController(), imageToolsAllowed: true,
      isBareImageExecution: () => false, extractBatchPrompts: () => [], fallbackImagePrompt: 'fallback',
      latestRefs: [], trackedChatCompletion: async () => ({ choices: [{ message: { content: '' } }] }),
      agentRuntime: { provider: { name: 'chat' }, model: { rawId: 'chat-model' } },
      requestedAgentImageModelId: 'auto',
      getRuntimeImageGenerationModel: async () => ({ provider: { name: 'image-provider' }, model: { id: 'image-model', rawId: 'image-raw', displayName: 'Image' } }),
      getRuntimeImageModelForCapability: async () => null,
      appendGenerationLog: async () => {}, sourceForLog: 'agent', taskContext: {},
      startGenerationLog: async () => 'media-log-summary-1', referenceRecords: [],
      getRuntimeImageModelCandidates: () => [], editImage: async () => [],
      generateImage: async () => [{ url: 'data:image/png;base64,ZmFrZQ==' }],
      persistGenerationResult: async () => ({ images: [{ url: artifactRef }] }),
      reviewImageArtifact: async () => review,
      imageDownloadAuth: () => undefined, finishGenerationLog: async (_id, patch) => { persistedReview = patch.creativeReview; }, skipCaption: true,
      latestInstruction: '请生成咖啡广告图',
      executionPublicState: { settings: {} },
    },
  });
  const payload = JSON.parse(String(result.results[0].content));
  assert.deepEqual(payload.images.map((entry) => entry.ref), [artifactRef]);
  assert.equal('creativeReviewSummary' in payload, false, 'review summaries stay out of the user-visible tool result');
  assert.equal('creativeReview' in payload, false, 'the Agent does not receive a long report without a concrete failure');
  assert.equal('creativeReview' in generated[0], false, 'non-failing reports stay out of the user-visible image metadata');
  assert.deepEqual(persistedReview, [review], 'the full report remains in the internal generation record');
});

test('Filesystem edit_file dry-runs are reported as previews in the MCP call summary', async () => {
  const { state, input } = createWindowsMcpTestContext({ mcpCall: async () => ({ isError: false, text: 'diff preview' }) });
  const server = { id: 'filesystem-test', name: '本地文件', url: 'stdio://filesystem', catalogId: 'filesystem', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'edit_file', readOnly: false, blocked: false };
  const call = { id: 'filesystem-preview' };
  const args = { path: 'C:\\Temp\\fixture\\note.txt', edits: [{ oldText: 'before', newText: 'after' }], dryRun: true };
  Object.assign(input, {
    call,
    args,
    policy: { tool: { mcp: meta, risk: 'external_side_effect' } },
    stepCalls: [call],
    mcpServerById: new Map([[server.id, server]]),
    mcpCall: async (_targetServer, _toolName, receivedArgs) => {
      assert.equal(receivedArgs.dryRun, true);
      return { isError: false, text: 'diff preview' };
    },
  });

  const result = await mcpCapabilities.executeMcpCapability(input);
  assert.equal(JSON.parse(result.results[0].content).ok, true);
  assert.deepEqual(state.usedMcpTools, [{ server: '本地文件', name: 'edit_file', readOnly: false, ok: true, preview: true }]);
});

test('MCP call summary distinguishes previews from writes', () => {
  const markup = renderToStaticMarkup(createElement(AgentMcpDetailDock, {
    tools: [
      { server: '本地文件', name: 'edit_file', readOnly: false, ok: true, preview: true },
      { server: '本地文件', name: 'write_file', readOnly: false, ok: true },
    ],
    Icon: () => null,
    onClose: () => {},
  }));
  assert.match(markup, /预览/);
  assert.match(markup, /预览完成/);
  assert.match(markup, /写入/);
  assert.match(markup, /已完成/);
  assert.match(markup, /预览调用只返回差异，不会落盘/);
});

test('MCP stops after the same tool returns the same error twice', async () => {
  const calls = [];
  const { state, input } = createWindowsMcpTestContext({
    mcpCall: async (_server, toolName, args) => {
      calls.push({ toolName, args });
      return { isError: true, text: 'ENOENT: requested file does not exist' };
    },
  });

  const first = await mcpCapabilities.executeMcpCapability(input);
  assert.equal(first.stalled, undefined, 'one failure still allows a safe recovery attempt');
  input.call = { id: 'desktop-current-retry' };
  input.stepCalls = [input.call, { id: 'desktop-following-retry' }];
  const second = await mcpCapabilities.executeMcpCapability(input);

  assert.equal(calls.length, 2);
  assert.equal(second.stalled, true);
  assert.match(state.stalledMcpReason, /连续 2 次返回相同的错误/);
  assert.match(JSON.parse(second.results[0].content).error, /提供新线索或指定替代路径/);
  assert.equal(second.results[1].tool_call_id, 'desktop-following-retry');
});

test('a successful MCP call resets the repeated-error streak', async () => {
  const replies = [
    { isError: true, text: 'ENOENT: requested file does not exist' },
    { isError: false, text: 'alternate path found' },
    { isError: true, text: 'ENOENT: requested file does not exist' },
  ];
  let calls = 0;
  const { state, input } = createWindowsMcpTestContext({ mcpCall: async () => replies[calls++] });

  const outcomes = [];
  for (let index = 0; index < replies.length; index += 1) {
    input.call = { id: 'desktop-streak-' + index };
    input.stepCalls = [input.call];
    outcomes.push(await mcpCapabilities.executeMcpCapability(input));
  }

  assert.equal(calls, 3);
  assert.equal(outcomes[0].stalled, undefined);
  assert.equal(outcomes[1].stalled, undefined);
  assert.equal(outcomes[2].stalled, undefined);
  assert.equal(state.stalledMcpReason, '');
});

test('Windows-MCP stops immediately after user input takes control instead of polling for 30 seconds', async () => {
  const state = {
    generatedFiles: [], mcpToolCallCount: 0, mcpTurnBudget: 60_000, usedMcpTools: [], browserUses: [],
    browserRecoveryNeeded: false, generated: [], browserDownloadCount: 0, stalledMcpReason: '',
    batchItems: [], generations: [], recentPageText: '', skillToolCalls: 0, skillInstalls: 0,
    generatedArtifactCount: 0, usedSkills: [],
  };
  const server = { id: 'cursortouch-windows-mcp', name: 'Windows MCP', url: 'stdio://windows-mcp', catalogId: 'windows-mcp', enabled: true, allowWrite: true };
  const meta = { serverId: server.id, serverName: server.name, toolName: 'App', readOnly: false, blocked: false };
  const calls = [{ id: 'desktop-current' }, { id: 'desktop-following' }];
  const invokedTools = [];
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
      invokedTools.push(toolName);
      return { isError: true, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 7 } }) };
    },
    reportProgress: () => {},
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

  assert.deepEqual(invokedTools, ['App']);
  assert.equal(state.mcpToolCallCount, 1);
  assert.match(state.stalledMcpReason, /立即停止，不会继续等待或自动重放/);
  assert.equal(result.stalled, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].tool_call_id, 'desktop-following');
});

test('Windows-MCP user-control handoff stops without waiting even when the turn budget is low', async () => {
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
  assert.equal(result.stalled, true);
  assert.match(state.stalledMcpReason, /立即停止，不会继续等待或自动重放/);
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

test('Windows-MCP stops immediately when CONTROL_PREEMPTED reports an unavailable controller', async () => {
  const calls = [];
  let waited = false;
  const { state, input } = createWindowsMcpTestContext({
    mcpCall: async (_server, toolName) => {
      calls.push(toolName);
      return {
        isError: true,
        text: '执行中曾遇到错误： windows-mcp_App: {"code":"CONTROL_PREEMPTED","status":{"state":"unavailable","generation":5,"wait_seconds":0.0,"executed_steps":0}}',
      };
    },
    waitForMcpRetry: async () => { waited = true; },
  });

  const result = await mcpCapabilities.executeMcpCapability(input);

  assert.deepEqual(calls, ['App']);
  assert.equal(waited, false);
  assert.equal(result.stalled, true);
  assert.match(state.stalledMcpReason, /控制器当前不可用/);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].tool_call_id, 'desktop-following');
});

test('Windows-MCP user-control errors do not trigger delayed status polling or replay', async () => {
  const calls = [];
  const waits = [];
  const { state, input } = createWindowsMcpTestContext({
    mcpCallTimeoutMs: 120_000,
    mcpCall: async (_server, toolName, _args, options) => {
      calls.push(toolName);
      assert.equal(options.timeouts.call, 30_000);
      return { isError: true, text: JSON.stringify({ code: 'USER_CONTROL', status: { state: 'user', wait_seconds: 20 } }) };
    },
    waitForMcpRetry: async (milliseconds) => waits.push(milliseconds),
  });

  const result = await mcpCapabilities.executeMcpCapability(input);

  assert.deepEqual(calls, ['App']);
  assert.deepEqual(waits, []);
  assert.equal(result.stalled, true);
  assert.match(state.stalledMcpReason, /立即停止，不会继续等待或自动重放/);
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

test('artifact validation failures preserve the specific reason in tool results', async () => {
  const { executeArtifactCapability } = load('./packages/tool-runtime/artifact-capability');
  const scenarios = [
    { count: artifactLimits.ARTIFACT_MAX_PER_TURN, args: {}, error: /本轮最多生成/ },
    { count: 0, args: {}, error: /没有可打包的文件/ },
    { count: 0, args: { artifactIds: ['valid-id'] }, error: /指定的文件已过期或被清理/ },
  ];
  for (const scenario of scenarios) {
    const state = { generatedFiles: [], generatedArtifactCount: scenario.count };
    const result = await executeArtifactCapability({
      state,
      call: { id: 'invalid-archive', function: { name: 'archive_generate' } },
      args: scenario.args,
      signal: new AbortController().signal,
      infrastructure: {
        ...artifactInfrastructure,
        isValidArtifactId: () => true,
        collectArchiveEntries: async () => ({ entries: [], missing: ['valid-id'] }),
      },
    });
    const payload = JSON.parse(String(result.content));
    assert.equal(payload.ok, false);
    assert.match(payload.error, scenario.error);
    assert.equal(state.generatedFiles.length, 0);
  }
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

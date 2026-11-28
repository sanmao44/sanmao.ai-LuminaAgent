import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());

test('API application entry executes a provider-neutral AgentRun', async () => {
  const { runPlainAgentTurn } = load('./apps/api/agent-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  const descriptor = { id: 'test-model', displayName: 'Test model', capabilities: { text: true, reasoning: false, toolUse: false, structuredOutput: false } };
  const result = await runPlainAgentTurn({
    runId: 'api-boundary-test',
    model: descriptor,
    messages: [{ role: 'user', content: 'hello' }],
    runtime: {
      descriptor,
      provider: { invoke: async () => ({ content: 'hello from runtime', modelId: 'test-model' }) },
      invoke: async () => ({ content: 'hello from runtime', modelId: 'test-model' }),
    },
    observer,
  });
  assert.equal(result.output, 'hello from runtime');
  assert.deepEqual(observer.snapshot().map((event) => event.phase), ['started', 'completed']);
});

test('Agent planning boundary produces a stable execution plan without transport dependencies', () => {
  const { planAgentRequest } = load('./packages/agent-core/request-planning');
  const planningPorts = {
    ...load('./lib/agent-web'),
    ...load('./lib/agent-intent'),
    ...load('./lib/agent-context'),
    ...load('./lib/agent-routing'),
    ...load('./lib/creative-references'),
  };
  const plan = planAgentRequest({
    body: { webMode: 'off' },
    messages: [{ role: 'user', content: 'hello' }],
    isCanvasSource: false,
    isCanvasNodeExecution: false,
    canvasTargetNodeIds: [],
    canvasTargetKind: 'none',
    canvasTargetOperation: 'generate',
    ports: planningPorts,
  });
  assert.equal(plan.requestRoute.route, 'chat');
  assert.equal(plan.requestModeAllowsExecution, false);
  assert.equal(plan.modelContextMessages.at(-1).content, 'hello');
  assert.equal(plan.webMode, 'off');
});

test('Agent planning carries a public video URL into a short download follow-up', () => {
  const { planAgentRequest } = load('./packages/agent-core/request-planning');
  const planningPorts = {
    ...load('./lib/agent-web'),
    ...load('./lib/agent-intent'),
    ...load('./lib/agent-context'),
    ...load('./lib/agent-routing'),
    ...load('./lib/creative-references'),
  };
  const plan = planAgentRequest({
    body: { webMode: 'off' },
    messages: [
      { role: 'user', content: 'https://www.youtube.com/watch?v=example123' },
      { role: 'assistant', content: '我收到这个链接了。' },
      { role: 'user', content: '下载' },
    ],
    isCanvasSource: false,
    isCanvasNodeExecution: false,
    canvasTargetNodeIds: [],
    canvasTargetKind: 'none',
    canvasTargetOperation: 'generate',
    ports: planningPorts,
  });
  assert.match(plan.latestInstruction, /下载\s+https:\/\/www\.youtube\.com\/watch\?v=example123/);
  assert.equal(plan.modelContextMessages.at(-1).content, plan.latestInstruction);
});

test('Agent planning authorizes a browser action only when it continues an opened page', () => {
  const { planAgentRequest } = load('./packages/agent-core/request-planning');
  const planningPorts = {
    ...load('./lib/agent-web'),
    ...load('./lib/agent-intent'),
    ...load('./lib/agent-context'),
    ...load('./lib/agent-routing'),
    ...load('./lib/creative-references'),
  };
  const plan = planAgentRequest({
    body: { webMode: 'off' },
    messages: [
      { role: 'user', content: 'Open bilibili' },
      { role: 'assistant', content: 'Bilibili is open.' },
      { role: 'user', content: 'Click the first video' },
    ],
    isCanvasSource: false,
    isCanvasNodeExecution: false,
    canvasTargetNodeIds: [],
    canvasTargetKind: 'none',
    canvasTargetOperation: 'generate',
    ports: planningPorts,
  });
  assert.equal(plan.requestRoute.route, 'browser');
  assert.equal(plan.requestModeAllowsExecution, true);
  assert.deepEqual(plan.modelContextMessages.slice(0, -1).map((message) => message.content), [
    'Open bilibili',
    'Bilibili is open.',
  ]);
});

test('Agent execution boundary owns bounded skill and artifact follow-ups', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  const messages = [{ role: 'user', content: 'prepare delivery' }];
  const calls = [];
  const toolRuntime = {
    async runLoop(options) {
      const outcome = await options.callModel({ step: 0, messages: options.messages });
      const requested = Array.isArray(outcome?.tool_calls) ? outcome.tool_calls : [];
      if (requested.length) await options.runCalls(requested, { step: 0 });
      return { text: 'follow-up complete', trace: [{ step: 0, calls: requested.map((call) => call.function.name), durationMs: 1, continued: false }] };
    },
    async executeCalls(runtimeCalls) { calls.push(...runtimeCalls); return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runCapabilityFollowups({
    messages,
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    callModel: async ({ tools }) => ({ tool_calls: [{ id: 'followup-1', function: { name: tools[0].function.name } }] }),
    skillTools: [{ function: { name: 'skill_read' } }],
    artifactTools: [{ function: { name: 'archive_generate' } }],
    skillToolCalls: 1,
    artifactRequested: true,
    initialToolCalls: [{ id: 'initial-1', function: { name: 'document_generate' } }],
    hasGenerated: false,
    hasGeneratedFiles: false,
    hasWebSearch: false,
  });
  assert.equal(result.skillText, 'follow-up complete');
  assert.equal(result.artifactText, 'follow-up complete');
  assert.deepEqual(calls.map((call) => call.function.name), ['skill_read', 'archive_generate']);
  assert.equal(result.trace.length, 2);
});

test('a generated PPT image continues to the presentation tool with its returned ref', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  const imageRef = '/api/storage/file?name=ppt-visual.png';
  const messages = [
    { role: 'user', content: 'Create a PPT with an automatically generated visual.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'image-1', function: { name: 'image_generate', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'image-1', content: JSON.stringify({ ok: true, images: [{ ref: imageRef }] }) },
  ];
  const executed = [];
  const toolRuntime = {
    async runLoop(options) {
      const reply = await options.callModel({ step: 0, messages: options.messages });
      const requested = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
      await options.runCalls(requested, { step: 0 });
      executed.push(...requested);
      return { text: 'PPT generated', trace: [{ step: 0, calls: requested.map((call) => call.function.name), durationMs: 1, continued: false }] };
    },
    async executeCalls(calls) { return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runCapabilityFollowups({
    messages,
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    boundAgentContext: (items) => items,
    boundToolResult: (content) => content,
    callModel: async ({ messages: followupMessages, tools }) => {
      assert.ok(JSON.stringify(followupMessages).includes(imageRef), 'the image ref must reach PPT planning');
      assert.deepEqual(tools.map((tool) => tool.function.name), ['presentation_generate']);
      return { tool_calls: [{ id: 'ppt-1', function: { name: 'presentation_generate', arguments: '{}' } }] };
    },
    skillTools: [],
    artifactTools: [{ function: { name: 'presentation_generate' } }],
    skillToolCalls: 0,
    artifactRequested: true,
    continueAfterImage: true,
    initialToolCalls: [{ id: 'image-1', function: { name: 'image_generate' } }],
    hasGenerated: true,
    hasGeneratedFiles: false,
    hasWebSearch: false,
  });
  assert.equal(result.artifactText, 'PPT generated');
  assert.deepEqual(executed.map((call) => call.function.name), ['presentation_generate']);
});

test('an unavailable PPT image continues to the presentation tool without a generated file', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  let loops = 0;
  const toolRuntime = {
    async runLoop() {
      loops += 1;
      return { text: 'PPT generated without an image', trace: [] };
    },
    async executeCalls() { return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runCapabilityFollowups({
    messages: [{ role: 'user', content: 'Create a PPT with an illustration.' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    callModel: async () => null,
    skillTools: [],
    artifactTools: [{ function: { name: 'presentation_generate' } }],
    skillToolCalls: 0,
    artifactRequested: true,
    continueAfterImage: true,
    imageAttemptUnavailable: true,
    initialToolCalls: [{ id: 'image-failed', function: { name: 'image_generate' } }],
    hasGenerated: false,
    hasGeneratedFiles: false,
    hasWebSearch: false,
  });

  assert.equal(loops, 1);
  assert.equal(result.artifactText, 'PPT generated without an image');
});

test('a completed artifact is not generated again by a capability follow-up', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  let loops = 0;
  const toolRuntime = {
    async runLoop() { loops += 1; return { text: 'duplicate', trace: [] }; },
    async executeCalls() { return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runCapabilityFollowups({
    messages: [{ role: 'user', content: 'Create a PPT.' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    callModel: async () => null,
    skillTools: [],
    artifactTools: [{ function: { name: 'presentation_generate' } }],
    skillToolCalls: 0,
    artifactRequested: true,
    initialToolCalls: [{ id: 'ppt-done', function: { name: 'presentation_generate' } }],
    hasGenerated: false,
    hasGeneratedFiles: true,
    hasWebSearch: false,
  });

  assert.equal(loops, 0);
  assert.equal(result.artifactText, '');
});

test('artifact follow-up stops after the generated file is returned', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  let canContinue;
  const toolRuntime = {
    async runLoop(options) {
      const call = { id: 'ppt-delivered', function: { name: 'presentation_generate' } };
      await options.runCalls([call], { step: 0 });
      canContinue = options.shouldContinue({ step: 1, toolCallCount: 1, elapsedMs: 1 });
      return { text: '', trace: [] };
    },
    async executeCalls(calls) {
      return {
        results: calls.map((call) => ({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, file: { name: 'deck.pptx' } }) })),
        deferredCalls: [],
        stalled: false,
      };
    },
  };
  await runCapabilityFollowups({
    messages: [{ role: 'user', content: 'Create a PPT.' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    callModel: async () => null,
    skillTools: [],
    artifactTools: [{ function: { name: 'presentation_generate' } }],
    skillToolCalls: 0,
    artifactRequested: true,
    initialToolCalls: [{ id: 'ppt-start', function: { name: 'presentation_generate' } }],
    hasGenerated: false,
    hasGeneratedFiles: false,
    hasWebSearch: false,
  });

  assert.equal(canContinue, false);
});

test('failed HTML file delivery gets one repair using only the file tool', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  const { runToolLoop } = load('./packages/tool-runtime/tool-loop');
  for (const repaired of [true, false]) {
    const initialCall = { id: 'html-initial', function: { name: 'file_generate', arguments: '{"files":[]}' } };
    const messages = [
      { role: 'user', content: 'Generate an HTML file.' },
      { role: 'assistant', content: null, tool_calls: [initialCall] },
      { role: 'tool', tool_call_id: initialCall.id, content: JSON.stringify({ ok: false, error: '没有收到有效的文件内容' }) },
    ];
    let modelCalls = 0;
    const executed = [];
    const result = await runCapabilityFollowups({
      messages,
      contextMaxChars: 4000,
      signal: new AbortController().signal,
      boundAgentContext: (items) => items,
      boundToolResult: (content) => content,
      toolRuntime: {
        runLoop: runToolLoop,
        async executeCalls(calls) {
          executed.push(...calls);
          return {
            results: calls.map((call) => ({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(repaired
              ? { ok: true, count: 1, files: [{ name: 'page.html', size: 23 }] }
              : { ok: false, error: '没有收到有效的文件内容' }) })),
            deferredCalls: [],
            stalled: false,
          };
        },
      },
      callModel: async ({ messages: current, tools }) => {
        modelCalls += 1;
        assert.match(current.at(-1).content, /没有收到有效的文件内容/);
        assert.deepEqual(tools.map((tool) => tool.function.name), ['file_generate']);
        return { tool_calls: [{ id: 'html-repair', function: { name: 'file_generate', arguments: '{"files":[{"filename":"page.html","content":"<html>fixed</html>"}]}' } }] };
      },
      skillTools: [],
      artifactTools: [{ function: { name: 'file_generate' } }, { function: { name: 'presentation_generate' } }],
      skillToolCalls: 0,
      artifactRequested: true,
      initialToolCalls: [initialCall],
      hasGenerated: false,
      hasGeneratedFiles: false,
      hasWebSearch: false,
    });
    assert.equal(modelCalls, 1, 'file repair must not start another model round');
    assert.equal(executed.length, 1);
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0].continued, !repaired);
    assert.equal(messages.at(-1).tool_call_id, 'html-repair');
  }
});

test('a delivered HTML file does not enter file parameter repair', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  await runCapabilityFollowups({
    messages: [{ role: 'user', content: 'Generate an HTML file.' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime: {
      async runLoop() { assert.fail('a delivered file must not be regenerated'); },
      async executeCalls() { assert.fail('a delivered file must not be regenerated'); },
    },
    boundAgentContext: (items) => items,
    boundToolResult: (content) => content,
    callModel: async () => { assert.fail('a delivered file needs no repair request'); },
    skillTools: [],
    artifactTools: [{ function: { name: 'file_generate' } }],
    skillToolCalls: 0,
    artifactRequested: true,
    initialToolCalls: [{ id: 'html-delivered', function: { name: 'file_generate' } }],
    hasGenerated: false,
    hasGeneratedFiles: true,
    hasWebSearch: false,
  });
});

test('Skill follow-up rejects a tool that was not offered without executing it', async () => {
  const { runCapabilityFollowups } = load('./apps/api/agent-execution');
  const executed = [];
  const toolRuntime = {
    async runLoop(options) {
      const reply = await options.callModel({ step: 0, messages: options.messages });
      const requested = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
      const results = await options.runCalls(requested, { step: 0 });
      assert.match(String(results[0]?.content || ''), /只允许调用当前下发的工具/);
      return { text: '根据技能正文完成回答。', trace: [{ step: 0, calls: ['file_generate'], durationMs: 1, continued: false }] };
    },
    async executeCalls(calls) { executed.push(...calls); return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runCapabilityFollowups({
    messages: [{ role: 'user', content: '写段离职申请' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    callModel: async () => ({ tool_calls: [{ id: 'file-1', function: { name: 'file_generate', arguments: '{}' } }] }),
    skillTools: [{ function: { name: 'skill_read' } }],
    artifactTools: [],
    skillToolCalls: 1,
    artifactRequested: false,
    initialToolCalls: [{ id: 'skill-1', function: { name: 'skill_read' } }],
    hasGenerated: false,
    hasGeneratedFiles: false,
    hasWebSearch: false,
  });
  assert.equal(result.skillText, '根据技能正文完成回答。');
  assert.deepEqual(executed, []);
});

test('Agent execution boundary owns MCP continuation lifecycle', async () => {
  const { runMcpCapabilityFollowup } = load('./apps/api/agent-execution');
  const calls = [];
  const toolRuntime = {
    async runLoop(options) {
      const reply = await options.callModel({ step: 0, messages: options.messages });
      const requested = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
      if (requested.length) await options.runCalls(requested, { step: 0 });
      return { text: 'browser complete', trace: [{ step: 0, calls: requested.map((call) => call.function.name), durationMs: 1, continued: false }], stopReason: 'no_tool_calls' };
    },
    async executeCalls(runtimeCalls) { calls.push(...runtimeCalls); return { results: [], deferredCalls: [], stalled: false }; },
  };
  const result = await runMcpCapabilityFollowup({
    messages: [{ role: 'user', content: 'open the page' }],
    contextMaxChars: 4000,
    signal: new AbortController().signal,
    toolRuntime,
    mcpTools: [{ function: { name: 'browser_open' } }],
    maxSteps: 2,
    maxCalls: 2,
    callModel: async () => ({ tool_calls: [{ id: 'mcp-1', function: { name: 'browser_open' } }] }),
    shouldContinue: () => false,
  });
  assert.equal(result.text, 'browser complete');
  assert.deepEqual(calls.map((call) => call.function.name), ['browser_open']);
  assert.equal(result.stopReason, 'no_tool_calls');
});

test('MCP follow-up preserves completed tool receipts before a later call is deferred', async () => {
  const { runMcpCapabilityFollowup } = load('./apps/api/agent-execution');
  const completed = { role: 'tool', tool_call_id: 'read-1', content: JSON.stringify({ ok: true, path: 'C:\\work\\brief.md' }) };
  const pending = { id: 'write-1', function: { name: 'filesystem__edit_file', arguments: '{}' } };
  const persisted = [];
  let deferred = [];
  const toolRuntime = {
    async runLoop(options) {
      const reply = await options.callModel({ step: 0, messages: options.messages });
      const results = await options.runCalls(reply.tool_calls, { step: 0 });
      assert.deepEqual(results, [completed]);
      return { text: '', trace: [{ step: 0, calls: ['filesystem__read_text_file', 'filesystem__edit_file'], durationMs: 1, continued: false }], stopReason: 'stopped' };
    },
    async executeCalls() { return { results: [completed], deferredCalls: [pending], stalled: false }; },
  };

  const result = await runMcpCapabilityFollowup({
    messages: [{ role: 'user', content: 'read and update the brief' }],
    signal: new AbortController().signal,
    toolRuntime,
    mcpTools: [{ function: { name: 'filesystem__read_text_file' } }, { function: { name: 'filesystem__edit_file' } }],
    maxSteps: 2,
    maxCalls: 2,
    callModel: async () => ({ tool_calls: [
      { id: 'read-1', function: { name: 'filesystem__read_text_file', arguments: '{}' } },
      pending,
    ] }),
    shouldContinue: () => false,
    setDeferredCalls: (calls) => { deferred = calls; },
    onExecutedResults: (results) => { persisted.push(...results); },
  });

  assert.deepEqual(persisted, [completed]);
  assert.deepEqual(deferred, [pending]);
  assert.deepEqual(result.deferredCalls, [pending]);
});
test('bounded MCP continuation reports an incomplete task instead of a neutral success placeholder', () => {
  const { mcpFollowupIncompleteMessage } = load('./apps/api/agent-execution');
  assert.equal(
    mcpFollowupIncompleteMessage('max_steps', 8, 11),
    '任务未完成：达到工具续轮上限（8 轮）。已执行 11 次工具调用，尚未得到最终答案。',
  );
  assert.equal(
    mcpFollowupIncompleteMessage('no_tool_calls', 1, 11),
    '任务未完成：模型停止调用工具但未提供最终文字答复。已执行 11 次工具调用，尚未得到最终答案。',
  );
  assert.equal(
    mcpFollowupIncompleteMessage('no_tool_calls', 1, 11, true),
    '任务未完成：模型续轮请求失败。已执行 11 次工具调用，尚未得到最终答案。',
  );
});

test('bounded MCP summaries preserve the stop reason and restrict claims to returned evidence', () => {
  const { mcpFollowupPartialMessage, mcpFollowupSummaryPrompt } = load('./apps/api/agent-execution');
  const prompt = mcpFollowupSummaryPrompt('max_steps', 8);
  assert.match(prompt, /只根据此前已经返回的工具结果/);
  assert.match(prompt, /用户请求仍未完成/);
  assert.match(prompt, /不要调用工具/);
  assert.equal(
    mcpFollowupPartialMessage('max_steps', 8, 7, '已读取仓库列表，未核实其余步骤。'),
    '任务未完成：达到工具续轮上限（8 轮）。以下整理只依据已返回的 7 次工具结果，未执行或未核验的步骤仍未完成。\n\n已读取仓库列表，未核实其余步骤。',
  );
  assert.equal(mcpFollowupPartialMessage('max_steps', 8, 7, '  '), '');
});

test('Worker entry executes and observes a clone task through its runner port', async () => {
  const { runCloneJob } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  const seen = [];
  await runCloneJob('clone-boundary-test', async (jobId) => { seen.push(jobId); }, observer);
  assert.deepEqual(seen, ['clone-boundary-test']);
  assert.deepEqual(observer.snapshot().map((event) => event.phase), ['started', 'completed']);
  assert.equal(observer.snapshot()[0].identity, 'clone');
});

test('Worker entry emits a failed task event and preserves the failure', async () => {
  const { runCloneJob } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  await assert.rejects(() => runCloneJob('clone-boundary-failure', async () => { throw new Error('runner failed'); }, observer), /runner failed/);
  assert.deepEqual(observer.snapshot().map((event) => event.phase), ['started', 'failed']);
  assert.equal(observer.snapshot()[1].errorClass, 'Error');
});

test('Worker owns stale Clone reconciliation through an injectable reaper', async () => {
  const { reapCloneTasks } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  let called = 0;
  const result = await reapCloneTasks(async () => { called += 1; return 2; }, observer);
  assert.equal(result, 2);
  assert.equal(called, 1);
  assert.deepEqual(observer.snapshot().map((event) => `${event.identity}:${event.phase}`), ['clone:started', 'clone:completed']);
});

test('Worker Clone command boundary owns creation, confirmation, metadata, and resume policy', async () => {
  const worker = load('./apps/worker/clone-task');
  const store = load('./lib/clone/store');
  const idempotencyKey = `clone-boundary-${Date.now()}-${Math.random()}`;
  const dispatched = [];
  const created = await worker.createCloneTask({
    reference: { name: 'Boundary reference', url: 'https://example.test/reference.png', seconds: 1, kind: 'image' },
    assets: [],
    options: { aspect: '16:9' },
    capabilities: {},
    models: { chat: '', image: '' },
    warnings: [],
    autoConfirmPlan: false,
    idempotencyKey,
  }, (id) => dispatched.push(`create:${id}`));
  const id = created.task.id;
  try {
    assert.equal(created.created, true);
    assert.deepEqual(dispatched, [`create:${id}`]);
    assert.equal((await worker.getCloneTask(id)).stage, 'queued');

    const shot = { index: 0, start: 0, end: 1, visual: 'visual', line: 'line', prompt: 'prompt', status: 'pending' };
    await store.updateCloneJob(id, { stage: 'planned', shots: [shot] });
    const confirmed = await worker.confirmCloneTask(id, { shots: [shot] }, (taskId) => dispatched.push(`confirm:${taskId}`));
    assert.equal(confirmed.stage, 'queued');
    assert.equal(confirmed.planConfirmed, true);
    assert.deepEqual(dispatched, [`create:${id}`, `confirm:${id}`]);

    const applied = await worker.updateCloneTaskMetadata(id, { appliedAt: '2026-10-04T00:00:00.000Z' });
    assert.equal(applied.appliedAt, '2026-10-04T00:00:00.000Z');

    await store.updateCloneJob(id, { stage: 'failed' });
    const resumed = await worker.resumeCloneTask(id, (taskId) => dispatched.push(`resume:${taskId}`));
    assert.equal(resumed.stage, 'failed');
    assert.deepEqual(dispatched, [`create:${id}`, `confirm:${id}`, `resume:${id}`]);

    await store.updateCloneJob(id, { stage: 'done' });
    await assert.rejects(() => worker.resumeCloneTask(id, () => dispatched.push(`unexpected:${id}`)), /已经结束了/);
    assert.deepEqual(dispatched, [`create:${id}`, `confirm:${id}`, `resume:${id}`]);
  } finally {
    await store.removeCloneJob(id);
  }
});

test('Worker exposes execution dispatch and clone cancellation is an explicit lifecycle transition', async () => {
  const { dispatchCloneExecutionJob, runCloneJob } = load('./apps/worker/task-entry');
  const { cloneCancellationPatch } = load('./apps/worker/task-control');
  assert.equal(typeof dispatchCloneExecutionJob, 'function');
  assert.equal(typeof runCloneJob, 'function');
  const patch = cloneCancellationPatch({ id: 'clone-1', stage: 'rendering' });
  assert.equal(patch?.stage, 'cancelled');
  assert.equal(patch?.cancelRequested, true);
  assert.equal(cloneCancellationPatch({ id: 'clone-2', stage: 'done' }), null);
});

test('Worker owns clone reassembly and Blueprint variant execution boundaries', async () => {
  const { rerenderCloneTask, renderCloneVariantTask, renderCloneVariantBatchTask } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const calls = [];
  const reassemblyObserver = new BufferedRuntimeObserver();
  const variantObserver = new BufferedRuntimeObserver();
  const batchObserver = new BufferedRuntimeObserver();
  const reassembled = await rerenderCloneTask('clone-reassembly', undefined, undefined, async (id) => { calls.push(`reassembly:${id}`); return { id, mode: 'reassembly' }; }, reassemblyObserver);
  const variant = await renderCloneVariantTask('clone-variant', { id: 'v1', name: 'V1', overrides: [] }, async (id, spec) => { calls.push(`variant:${id}:${spec.id}`); return { id, mode: 'variant' }; }, variantObserver);
  const batch = await renderCloneVariantBatchTask('clone-batch', [{ id: 'v1', name: 'V1', overrides: [] }], async (id, specs) => { calls.push(`batch:${id}:${specs.length}`); return [{ id, mode: 'batch' }]; }, batchObserver);
  assert.deepEqual(calls, ['reassembly:clone-reassembly', 'variant:clone-variant:v1', 'batch:clone-batch:1']);
  assert.equal(reassembled.mode, 'reassembly');
  assert.equal(variant.mode, 'variant');
  assert.equal(batch[0].mode, 'batch');
  assert.deepEqual(reassemblyObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['clone:started', 'clone:completed']);
  assert.deepEqual(variantObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['clone:started', 'clone:completed']);
  assert.deepEqual(batchObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['clone:started', 'clone:completed']);
});

test('Worker task boundaries execute video and upscale runners with lifecycle events', async () => {
  const { runVideoTask, runUpscaleTask } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const videoObserver = new BufferedRuntimeObserver();
  const upscaleObserver = new BufferedRuntimeObserver();
  const seen = [];
  const video = await runVideoTask('video-boundary-test', async (taskId) => { seen.push(`video:${taskId}`); return { status: 'running' }; }, videoObserver);
  const upscale = await runUpscaleTask('upscale-boundary-test', async (taskId) => { seen.push(`upscale:${taskId}`); return { status: 'succeeded' }; }, upscaleObserver);
  assert.deepEqual(seen, ['video:video-boundary-test', 'upscale:upscale-boundary-test']);
  assert.equal(video.status, 'running');
  assert.equal(upscale.status, 'succeeded');
  assert.deepEqual(videoObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['video:started', 'video:completed']);
  assert.deepEqual(upscaleObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['upscale:started', 'upscale:completed']);
});

test('Worker control owns missing task reads without creating a second lifecycle state machine', async () => {
  const worker = load('./apps/worker/task-control');
  assert.equal(await worker.getVideoTask('missing-video-task'), null);
  assert.equal(await worker.getUpscaleTask('missing-upscale-task'), null);
  assert.equal(typeof worker.refreshVideoTask, 'function');
  assert.equal(typeof worker.refreshUpscaleTask, 'function');
});

test('Worker task boundaries preserve task failures and emit failed lifecycle events', async () => {
  const { runVideoTask } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  await assert.rejects(() => runVideoTask('video-boundary-failure', async () => { throw new Error('video runner failed'); }, observer), /video runner failed/);
  assert.deepEqual(observer.snapshot().map((event) => `${event.identity}:${event.phase}`), ['video:started', 'video:failed']);
  assert.equal(observer.snapshot()[1].errorClass, 'Error');
});

test('Worker owns terminal task removal and local-save controls', async () => {
  const { removeVideoTask, removeUpscaleTask, saveVideoTask } = load('./apps/worker/task-control');
  assert.equal(typeof removeVideoTask, 'function');
  assert.equal(typeof removeUpscaleTask, 'function');
  assert.equal(typeof saveVideoTask, 'function');
});

test('Worker generation boundaries execute provider submissions through injectable runners', async () => {
  const { runVideoGeneration, runUpscaleGeneration } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const videoObserver = new BufferedRuntimeObserver();
  const upscaleObserver = new BufferedRuntimeObserver();
  const video = await runVideoGeneration({ input: { prompt: 'test' } }, async (options) => ({ id: options.input.prompt, status: 'pending' }), videoObserver);
  const upscale = await runUpscaleGeneration({ reference: 'image-ref', sourceImageId: 'image-1' }, async (options) => ({ task: { id: options.sourceImageId }, model: { id: 'test-model' } }), upscaleObserver);
  assert.equal(video.id, 'test');
  assert.equal(upscale.task.id, 'image-1');
  assert.deepEqual(videoObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['video:started', 'video:completed']);
  assert.deepEqual(upscaleObserver.snapshot().map((event) => `${event.identity}:${event.phase}`), ['upscale:started', 'upscale:completed']);
});

test('Provider streaming deadline preserves response status and bounds idle chunks', async () => {
  const { withProviderResponseDeadline } = load('./packages/model-runtime/invocation');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('first'));
      setTimeout(() => controller.enqueue(new TextEncoder().encode('second')), 5);
      setTimeout(() => controller.close(), 10);
    },
  });
  const response = await withProviderResponseDeadline({
    signal: new AbortController().signal,
    timeoutMs: 100,
    idleTimeoutMs: 50,
    operation: async () => new Response(body, { status: 207, headers: { 'x-provider': 'test' } }),
    timeoutError: (phase, timeoutMs) => new Error(`${phase}:${timeoutMs}`),
  });
  assert.equal(response.status, 207);
  assert.equal(response.headers.get('x-provider'), 'test');
  assert.equal(await response.text(), 'firstsecond');
});

test('Provider streaming continues across long pauses when the application disables the idle deadline', async () => {
  const { withProviderResponseDeadline } = load('./packages/model-runtime/invocation');
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first')); },
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 75));
      controller.enqueue(new TextEncoder().encode('second'));
      controller.close();
    },
  });
  const response = await withProviderResponseDeadline({
    signal: new AbortController().signal,
    timeoutMs: 10,
    idleTimeoutMs: null,
    operation: async () => new Response(body, { status: 200 }),
    timeoutError: (phase, timeoutMs) => new Error(`${phase}:${timeoutMs}`),
  });
  assert.equal(await response.text(), 'firstsecond');
});

test('Provider streaming remains cancellable by the caller when the idle deadline is disabled', async () => {
  const { withProviderResponseDeadline } = load('./packages/model-runtime/invocation');
  const request = new AbortController();
  let upstreamCancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first')); },
    pull() { return new Promise(() => {}); },
    cancel() { upstreamCancelled = true; },
  });
  const response = await withProviderResponseDeadline({
    signal: request.signal,
    timeoutMs: 100,
    idleTimeoutMs: null,
    operation: async () => new Response(body, { status: 200 }),
    timeoutError: (phase, timeoutMs) => new Error(`${phase}:${timeoutMs}`),
  });
  const reader = response.body.getReader();
  await reader.read();
  const pending = reader.read();
  request.abort(new Error('AGENT_CANCELLED'));
  assert.equal((await pending).done, true);
  assert.equal(upstreamCancelled, true);
});

test('Provider streaming deadline rejects when the first chunk never arrives', async () => {
  const { withProviderResponseDeadline } = load('./packages/model-runtime/invocation');
  const response = await withProviderResponseDeadline({
    signal: new AbortController().signal,
    timeoutMs: 10,
    idleTimeoutMs: 10,
    operation: async () => new Response(new ReadableStream(), { status: 200 }),
    timeoutError: (phase, timeoutMs) => new Error(`${phase}:${timeoutMs}`),
  }).catch((error) => error);
  assert.equal(response instanceof Error, true);
  assert.equal(response.message, 'initial:10');
});

test('Provider streaming deadline rejects when a later chunk stalls', async () => {
  const { withProviderResponseDeadline } = load('./packages/model-runtime/invocation');
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first')); },
    pull() { return new Promise(() => {}); },
  });
  const response = await withProviderResponseDeadline({
    signal: new AbortController().signal,
    timeoutMs: 100,
    idleTimeoutMs: 10,
    operation: async () => new Response(body, { status: 200 }),
    timeoutError: (phase, timeoutMs) => new Error(`${phase}:${timeoutMs}`),
  });
  await assert.rejects(() => response.text(), /idle:10/);
});

test('Agent model invoker routes application calls through the provider coordinator', async () => {
  const { createProviderCoordinator } = load('./packages/model-runtime/provider-coordinator');
  const { createAgentModelInvoker } = load('./packages/model-runtime/agent-invoker');
  const candidates = [
    { model: { id: 'one', displayName: 'One' }, provider: { id: 'p1', name: 'p1' } },
    { model: { id: 'two', displayName: 'Two' }, provider: { id: 'p2', name: 'p2' } },
  ];
  const coordinator = createProviderCoordinator({
    requestedModelId: 'auto', candidates, signal: new AbortController().signal,
    operationIdPrefix: 'invoker-test', nextAttempt: () => 1,
    timeoutMs: 1000, failoverTimeoutMs: 1000, idleTimeoutMs: 1000,
    timeoutError: () => new Error('timeout'), isCancelled: () => false,
  });
  const attempts = [];
  const invoker = createAgentModelInvoker({
    coordinator,
    defaultSignal: new AbortController().signal,
    invoke: async (runtime, payload) => {
      attempts.push(`${runtime.provider.name}:${payload.messages[0].content}`);
      if (attempts.length === 1) throw Object.assign(new Error('provider failed'), { providerFailureKind: 'transport' });
      return { provider: runtime.provider.name };
    },
  });
  const result = await invoker.invoke({ messages: [{ role: 'user', content: 'hello' }] });
  assert.deepEqual(attempts, ['p1:hello', 'p2:hello']);
  assert.deepEqual(result, { provider: 'p2' });
});

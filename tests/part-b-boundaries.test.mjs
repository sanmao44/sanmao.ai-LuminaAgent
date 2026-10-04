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
  const plan = planAgentRequest({
    body: { webMode: 'off' },
    messages: [{ role: 'user', content: 'hello' }],
    isCanvasSource: false,
    isCanvasNodeExecution: false,
    canvasTargetNodeIds: [],
    canvasTargetKind: 'none',
    canvasTargetOperation: 'generate',
  });
  assert.equal(plan.requestRoute.route, 'chat');
  assert.equal(plan.requestModeAllowsExecution, false);
  assert.equal(plan.modelContextMessages.at(-1).content, 'hello');
  assert.equal(plan.webMode, 'off');
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

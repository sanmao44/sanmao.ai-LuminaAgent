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

test('Worker exposes a separate execution dispatch for confirmed clone jobs', async () => {
  const { dispatchCloneExecutionJob, runCloneJob } = load('./apps/worker/task-entry');
  assert.equal(typeof dispatchCloneExecutionJob, 'function');
  assert.equal(typeof runCloneJob, 'function');
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

test('Worker task boundaries preserve task failures and emit failed lifecycle events', async () => {
  const { runVideoTask } = load('./apps/worker/task-entry');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  await assert.rejects(() => runVideoTask('video-boundary-failure', async () => { throw new Error('video runner failed'); }, observer), /video runner failed/);
  assert.deepEqual(observer.snapshot().map((event) => `${event.identity}:${event.phase}`), ['video:started', 'video:failed']);
  assert.equal(observer.snapshot()[1].errorClass, 'Error');
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

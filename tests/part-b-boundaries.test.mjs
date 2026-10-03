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

test('Provider invocation seam performs bounded failover and emits provider lifecycle events', async () => {
  const { invokeProviderWithFailover } = load('./packages/model-runtime/invocation');
  const { BufferedRuntimeObserver } = load('./packages/contracts/observability');
  const observer = new BufferedRuntimeObserver();
  const runtimes = [{ name: 'first' }, { name: 'second' }];
  let selected = 0;
  let attempts = 0;
  const result = await invokeProviderWithFailover({
    current: () => runtimes[selected],
    canFailover: true,
    advance: () => { selected += 1; return selected < runtimes.length; },
    signal: new AbortController().signal,
    operation: async (runtime) => { attempts += 1; if (runtime.name === 'first') throw new Error('first unavailable'); return 'ok'; },
    isCancelled: () => false,
    identity: (runtime) => runtime.name,
    operationIdPrefix: 'provider-boundary-test',
    observer,
    nextAttempt: () => attempts + 1,
  });
  assert.equal(result, 'ok');
  assert.deepEqual(observer.snapshot().map((event) => `${event.identity}:${event.phase}`), ['first:started', 'first:failed', 'second:started', 'second:completed']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());

test('streamed answers post-process accumulated text before final delivery', async () => {
  const { streamAgentResult } = load('./apps/api/agent-stream');
  const response = streamAgentResult(
    new Response('data: {"choices":[{"delta":{"content":"draft"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    { images: [], files: [], generations: [], model: 'test', deliverable: 'text', finalize: (text) => `${text} finalized` },
  );
  const body = await response.text();
  assert.match(body, /"type":"final"/);
  assert.match(body, /draft finalized/);
});

test('stream final event carries the server-authoritative intent preview', async () => {
  const { streamAgentResult } = load('./apps/api/agent-stream');
  const preview = {
    deliverable: 'IMAGE',
    mode: 'execute',
    reason: '明确的图片生成请求',
    confidence: 'high',
    route: 'image',
    contextNeed: 'recent',
  };
  const response = streamAgentResult(null, {
    images: [], files: [], generations: [], model: 'test', deliverable: 'IMAGE',
    intentPreview: preview, fallback: '已完成',
  });
  const events = (await response.text())
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')));
  const final = events.find((event) => event.type === 'final');
  assert.deepEqual(final.intentPreview, preview);
});

test('provider coordinator fails over automatic candidates', async () => {
  const { createProviderCoordinator } = load('./packages/model-runtime/provider-coordinator');
  const attempts = [];
  const candidates = [
    { model: { id: 'one', displayName: 'One' }, provider: { id: 'p1', name: 'p1' } },
    { model: { id: 'two', displayName: 'Two' }, provider: { id: 'p2', name: 'p2' } },
  ];
  const coordinator = createProviderCoordinator({
    requestedModelId: 'auto', candidates, signal: new AbortController().signal,
    operationIdPrefix: 'test', nextAttempt: () => attempts.length + 1,
    observer: undefined, timeoutMs: 1000, failoverTimeoutMs: 1000, idleTimeoutMs: 1000,
    timeoutError: () => new Error('timeout'), isCancelled: () => false,
  });
  const result = await coordinator.invoke({}, new AbortController().signal, async (runtime) => {
    attempts.push(runtime.provider.name);
    if (attempts.length === 1) throw Object.assign(new Error('upstream'), { providerFailureKind: 'transport' });
    return runtime.model.id;
  });
  assert.equal(result, 'two');
  assert.deepEqual(attempts, ['p1', 'p2']);
});

test('provider coordinator applies a capability-specific timeout to candidate failover', async () => {
  const { createProviderCoordinator } = load('./packages/model-runtime/provider-coordinator');
  const { createAgentModelInvoker } = load('./packages/model-runtime/agent-invoker');
  const candidates = [
    { model: { id: 'one', displayName: 'One' }, provider: { id: 'p1', name: 'p1' } },
    { model: { id: 'two', displayName: 'Two' }, provider: { id: 'p2', name: 'p2' } },
  ];
  const attempts = [];
  const coordinator = createProviderCoordinator({
    requestedModelId: 'auto', candidates, signal: new AbortController().signal,
    operationIdPrefix: 'candidate-timeout-test', nextAttempt: () => attempts.length + 1,
    observer: undefined, timeoutMs: 1000, failoverTimeoutMs: 1000, idleTimeoutMs: 1000,
    timeoutError: (_phase, timeoutMs) => new Error(`timeout:${timeoutMs}`), isCancelled: () => false,
  });
  const invoker = createAgentModelInvoker({
    coordinator,
    defaultSignal: new AbortController().signal,
    invoke: async (runtime, _payload, signal) => {
      attempts.push(runtime.model.id);
      if (runtime.model.id === 'one') return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        setTimeout(() => resolve('late response'), 25);
      });
      return 'fallback response';
    },
  });
  const result = await invoker.invokeCandidates(candidates, {}, new AbortController().signal, 5);
  assert.equal(result, 'fallback response');
  assert.deepEqual(attempts, ['one', 'two']);
});

test('provider coordinator applies a per-runtime deadline to Claude Std calls', async () => {
  const { createProviderCoordinator } = load('./packages/model-runtime/provider-coordinator');
  const runtime = {
    model: { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5' },
    provider: { id: 'claude', name: '65535 Claude Std' },
  };
  const coordinator = createProviderCoordinator({
    requestedModelId: runtime.model.id,
    candidates: [runtime],
    signal: new AbortController().signal,
    operationIdPrefix: 'claude-timeout-test',
    nextAttempt: () => 1,
    observer: undefined,
    timeoutMs: 5,
    failoverTimeoutMs: 5,
    timeoutFor: (candidate, mode) => candidate.provider.id === 'claude' && mode === 'manual' ? 50 : 5,
    idleTimeoutMs: null,
    timeoutError: (_phase, timeoutMs) => new Error(`timeout:${timeoutMs}`),
    isCancelled: () => false,
  });
  const result = await coordinator.invoke({ tools: [{ function: { name: 'file_generate' } }] }, new AbortController().signal, (_candidate, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('generated'), 20);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  }));
  assert.equal(result, 'generated');
});

test('provider coordinator keeps explicitly selected model single-homed', async () => {
  const { createProviderCoordinator } = load('./packages/model-runtime/provider-coordinator');
  const candidates = [
    { model: { id: 'one', displayName: 'One' }, provider: { id: 'p1', name: 'p1' } },
    { model: { id: 'two', displayName: 'Two' }, provider: { id: 'p2', name: 'p2' } },
  ];
  const coordinator = createProviderCoordinator({
    requestedModelId: 'one', candidates, signal: new AbortController().signal,
    operationIdPrefix: 'test', nextAttempt: () => 1,
    observer: undefined, timeoutMs: 1000, failoverTimeoutMs: 1000, idleTimeoutMs: 1000,
    timeoutError: () => new Error('timeout'), isCancelled: () => false,
  });
  await assert.rejects(() => coordinator.invoke({}, new AbortController().signal, async () => {
    throw new Error('selected provider failed');
  }), /selected provider failed/);
});

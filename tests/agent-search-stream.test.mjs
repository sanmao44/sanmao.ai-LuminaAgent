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

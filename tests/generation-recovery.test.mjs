import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const recovery = createTsRequire(process.cwd())('./lib/creation/generation-recovery');

test('background recovery selects each accepted task once without touching active or editor state', () => {
  const alreadyChecked = new Set(['done']);
  assert.deepEqual(recovery.acceptedGenerationTaskIdsForAutoCheck([
    { id: 'accepted', status: 'error', providerPossiblyAccepted: true },
    { id: 'active', status: 'pending', providerPossiblyAccepted: true },
    { id: 'checking', status: 'error', providerPossiblyAccepted: true, checkingAcceptedGeneration: true },
    { id: 'done', status: 'error', providerPossiblyAccepted: true },
    { id: 'ordinary-error', status: 'error', providerPossiblyAccepted: false },
    { id: 'accepted', status: 'error', providerPossiblyAccepted: true },
  ], alreadyChecked), ['accepted']);
  assert.deepEqual(recovery.acceptedGenerationTaskIdsForAutoCheck([
    { id: 'accepted', status: 'error', providerPossiblyAccepted: true },
  ], new Set(['accepted'])), []);
});

test('provider acceptance is recognized without treating it as a completed generation', () => {
  assert.equal(recovery.isProviderAcceptanceResponse(202, { pending: true, taskId: 'image-task' }), true);
  assert.equal(recovery.isProviderAcceptanceResponse(200, { pending: true }), true);
  assert.equal(recovery.isProviderAcceptanceResponse(200, { images: ['/image.png'] }), false);
  assert.equal(recovery.isProviderAcceptanceResponse(502, { error: 'failed' }), false);
});

test('accepted task log inspection separates recoverable output, confirmed failure and unresolved state', async () => {
  const logs = new Map([
    ['success', { status: 'success', imageUrls: ['/stored.png'] }],
    ['failure', { status: 'error', error: 'provider failed' }],
    ['pending', { status: 'pending' }],
    ['stale', { status: 'error', errorCode: 'provider_result_unconfirmed', error: 'provider receipt missing' }],
  ]);
  const results = await recovery.inspectAcceptedGenerationLogs(
    ['success', 'failure', 'pending', 'stale', 'missing'],
    async (taskId) => logs.get(taskId) || null,
  );

  assert.deepEqual(results.map(({ taskId, status }) => [taskId, status]), [
    ['success', 'success'],
    ['failure', 'error'],
    ['pending', 'pending'],
    ['stale', 'pending'],
    ['missing', 'missing'],
  ]);
  assert.deepEqual(results[0].imageUrls, ['/stored.png']);
});

test('a failed log lookup stays unresolved and never implies permission to resubmit', async () => {
  const results = await recovery.inspectAcceptedGenerationLogs(['accepted'], async () => {
    throw new Error('connection interrupted');
  });

  assert.deepEqual(results, [{ taskId: 'accepted', status: 'unavailable' }]);
});

test('pending accepted records stay blocked while confirmed failures allow only remaining work to retry', () => {
  const pendingProjection = recovery.projectAcceptedGenerationRecovery(1, 0, [
    { taskId: 'accepted', status: 'pending' },
  ]);
  assert.equal(pendingProjection.status, 'error');
  assert.equal(pendingProjection.phase, 'waiting');
  assert.equal(recovery.isGenerateRetryBlocked(pendingProjection), true);

  const batchProjection = recovery.projectAcceptedGenerationRecovery(3, 1, [
    { taskId: 'saved', status: 'success', log: { status: 'success' }, imageUrls: ['/saved.png'] },
    { taskId: 'failed', status: 'error', error: 'provider rejected request' },
    { taskId: 'accepted', status: 'pending' },
  ]);
  assert.equal(batchProjection.recoveredCount, 1);
  assert.equal(batchProjection.providerPossiblyAccepted, true);
  assert.deepEqual(batchProjection.unconfirmedTaskIds, ['accepted']);
  assert.equal(recovery.isGenerateRetryBlocked(batchProjection), true);

  const staleProjection = recovery.projectAcceptedGenerationRecovery(1, 0, [
    { taskId: 'stale', status: 'pending' },
  ]);
  assert.equal(staleProjection.phase, 'waiting');
  assert.equal(recovery.isGenerateRetryBlocked(staleProjection), true);

  const terminalProjection = recovery.projectAcceptedGenerationRecovery(2, 1, [
    { taskId: 'failed', status: 'error', error: 'provider rejected request' },
  ]);
  assert.equal(terminalProjection.status, 'error');
  assert.equal(terminalProjection.phase, 'retryable');
  assert.equal(recovery.isGenerateRetryBlocked(terminalProjection), false);
  assert.equal(recovery.acceptedGenerationGalleryItemId('child/task-1', 2), 'recovered-generation-child_task-1-2');
});

test('a confirmed successful record closes the recovery state only when every expected image is present', () => {
  const projection = recovery.projectAcceptedGenerationRecovery(2, 1, [
    { taskId: 'accepted', status: 'success', log: { status: 'success' }, imageUrls: ['/one.png'] },
  ]);

  assert.equal(projection.status, 'success');
  assert.equal(projection.phase, 'recovered');
  assert.equal(recovery.isGenerateRetryBlocked(projection), false);
});

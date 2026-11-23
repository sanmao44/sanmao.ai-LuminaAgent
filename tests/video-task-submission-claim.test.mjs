import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLibModules } from './lib-build.mjs';

test('video submission claims persist atomically and exclude accepted, in-flight, and deferred tasks', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-submission-claim-'));
  const previous = process.env.SANMAO_DATA_DIR;
  process.env.SANMAO_DATA_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const { main: store } = await buildLibModules(
    ['lib/task-store', 'lib/repositories/task-repository', 'lib/video-task-store'], 'video-task-store',
  );
  const now = Date.now();
  const create = async (key, patch = {}) => (await store.createVideoTask({
    providerId: 'fixture-provider', modelId: 'fixture-model', operation: 'generate',
    status: 'pending', idempotencyKey: key, input: { prompt: 'one video only' },
    errorCode: 'VIDEO_SUBMISSION_RETRY', nextPollAt: now - 1, ...patch,
  })).task;
  const retry = await create('retry');
  const claims = await Promise.all([
    store.claimVideoTaskSubmission(retry.id, now),
    store.claimVideoTaskSubmission(retry.id, now),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const persisted = await store.findVideoTask(retry.id);
  assert.equal(persisted.errorCode, 'VIDEO_SUBMISSION_IN_PROGRESS');
  assert.equal(persisted.nextPollAt, now + store.VIDEO_TASK_SUBMISSION_TIMEOUT_MS);

  for (const [key, patch] of [
    ['in-flight', { errorCode: 'VIDEO_SUBMISSION_IN_PROGRESS' }],
    ['accepted', { providerTaskId: 'upstream-task' }],
    ['deferred', { nextPollAt: now + 30_000 }],
    ['legacy-unknown', { errorCode: undefined }],
    ['cancelled', { status: 'cancelled' }],
  ]) {
    const task = await create(key, patch);
    assert.equal(await store.claimVideoTaskSubmission(task.id, now), null, key);
  }

  for (const errorCode of ['VIDEO_SUBMISSION_UNCONFIRMED', 'CANGYUAN_SUBMISSION_UNCONFIRMED']) {
    const task = await create(errorCode, { status: 'failed', errorCode });
    assert.deepEqual(await store.claimFailedVideoTaskRetry(task.id), { claimed: false, reason: 'not_retryable' });
  }

  const queryFailed = await create('query-failed', {
    status: 'failed', providerTaskId: 'original-upstream-id', providerStatus: 'network_error',
    errorCode: undefined, error: 'Invalid URL (GET /v1/tasks/original-upstream-id)',
  });
  const recoveries = await Promise.all([
    store.resumeVideoTaskResultRecovery(queryFailed.id, now),
    store.resumeVideoTaskResultRecovery(queryFailed.id, now),
  ]);
  assert.equal(recoveries.filter(Boolean).length, 1);
  const recovering = await store.findVideoTask(queryFailed.id);
  assert.equal(recovering.status, 'pending');
  assert.equal(recovering.providerTaskId, 'original-upstream-id');
  assert.equal(recovering.resultRecoveryStartedAt, now);

  for (const patch of [
    { status: 'cancelled' },
    { errorCode: 'VIDEO_PROVIDER_FAILED' },
    { providerResponse: { data: { status: 'failed' } } },
  ]) {
    const task = await create(`terminal-${JSON.stringify(patch)}`, {
      status: 'failed', providerTaskId: 'terminal-upstream-id', ...patch,
    });
    assert.equal(await store.resumeVideoTaskResultRecovery(task.id, now), null);
  }

  const completed = await create('manual-completed', { status: 'done', videoUrls: ['https://cdn.example/original.mp4'] });
  assert.deepEqual(await store.claimFailedVideoTaskRetry(completed.id, now), { claimed: false, reason: 'not_retryable' });
  const manualClaims = await Promise.all([
    store.claimFailedVideoTaskRetry(completed.id, now, { manualRetry: true }),
    store.claimFailedVideoTaskRetry(completed.id, now, { manualRetry: true }),
  ]);
  assert.equal(manualClaims.filter((claim) => claim.claimed).length, 1);
  assert.equal((await store.findVideoTask(completed.id)).status, 'done');
  await store.releaseFailedVideoTaskRetry(completed.id, now);
  const manualChild = await create('manual-first-child', { status: 'pending', retryOf: completed.id });
  const sharedChild = await store.claimFailedVideoTaskRetry(completed.id, now + 1, { manualRetry: true });
  assert.equal(sharedChild.claimed, false);
  assert.equal(sharedChild.task.id, manualChild.id);
  await store.updateVideoTask(manualChild.id, { status: 'done', videoUrls: ['https://cdn.example/retry.mp4'] });
  const nextManual = await store.claimFailedVideoTaskRetry(completed.id, now + 2, { manualRetry: true });
  assert.equal(nextManual.claimed, true);
  assert.equal(nextManual.retryAttempt, 2);
  await store.releaseFailedVideoTaskRetry(completed.id, now + 2);
  const uncertainChild = await create('manual-unknown-child', {
    status: 'failed', retryOf: completed.id, errorCode: 'VIDEO_SUBMISSION_UNCONFIRMED',
  });
  const blockedManual = await store.claimFailedVideoTaskRetry(completed.id, now + 3, { manualRetry: true });
  assert.equal(blockedManual.claimed, false);
  assert.equal(blockedManual.task.id, uncertainChild.id);

  const failedSource = await create('batch-unknown-retry-source', { status: 'failed', errorCode: 'VIDEO_PROVIDER_FAILED' });
  await create('batch-unknown-retry-child', { status: 'failed', retryOf: failedSource.id, errorCode: 'CANGYUAN_SUBMISSION_UNCONFIRMED' });
  assert.deepEqual(await store.claimFailedVideoTaskRetry(failedSource.id, now), { claimed: false, reason: 'retry_in_progress' });
});

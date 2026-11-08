import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  CANVAS_VIDEO_RETRY_BATCH_LIMIT,
  canRetryCanvasVideoLog,
  retryCanvasVideoLogs,
  retryableCanvasVideoLogs,
} = createTsRequire(process.cwd())('./lib/canvas/batch-video-retry');
const { filterCanvasGenerationLogs } = createTsRequire(process.cwd())('./lib/canvas/activity-log');

const log = (id, overrides = {}) => ({
  id,
  status: 'error',
  mode: 'video',
  prompt: `prompt-${id}`,
  ...overrides,
});

test('batch candidates include only explicit failed video tasks and de-duplicate task IDs', () => {
  const logs = [
    log('video-1', { taskId: 'shared-task' }),
    log('video-duplicate', { taskId: 'shared-task' }),
    log('uncertain', { errorCode: 'provider_result_unconfirmed' }),
    log('running', { status: 'pending' }),
    log('image', { mode: 'generate', mediaKind: 'image' }),
    log('audio', { mode: 'audio' }),
    log('video-2'),
  ];

  assert.equal(canRetryCanvasVideoLog(logs[0]), true);
  assert.equal(canRetryCanvasVideoLog(logs[2]), false);
  assert.deepEqual(retryableCanvasVideoLogs(logs).map(({ id }) => id), ['video-1', 'video-2']);
  assert.equal(logs.length, 7);
});

test('batch candidates stay within the visible media, status, and search filters', () => {
  const logs = [
    log('visible-video', { prompt: 'night highway' }),
    log('hidden-search-video', { prompt: 'day highway' }),
    log('hidden-status-video', { prompt: 'night road', status: 'success' }),
    log('hidden-media-image', { prompt: 'night highway', mediaKind: 'image', mode: 'generate' }),
  ];
  const visible = filterCanvasGenerationLogs(logs, { media: 'video', status: 'error', query: 'night' });

  assert.deepEqual(retryableCanvasVideoLogs(visible).map(({ id }) => id), ['visible-video']);
});

test('previously submitted tasks are excluded before applying the batch limit', () => {
  const logs = Array.from({ length: CANVAS_VIDEO_RETRY_BATCH_LIMIT + 2 }, (_, index) => log(`video-${index}`));
  const alreadyRetried = new Set(logs.slice(0, CANVAS_VIDEO_RETRY_BATCH_LIMIT).map(({ id }) => id));

  assert.deepEqual(
    retryableCanvasVideoLogs(logs, alreadyRetried).map(({ id }) => id),
    ['video-8', 'video-9'],
  );
});

test('batch processing caps the number of tasks and isolates each failure with concurrency two', async () => {
  const logs = Array.from({ length: CANVAS_VIDEO_RETRY_BATCH_LIMIT + 2 }, (_, index) => log(`video-${index}`));
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const result = await retryCanvasVideoLogs(logs, async (task) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (task.id === 'video-2') throw new Error('provider rejected task');
  }, (completed, total) => progress.push([completed, total]));

  assert.equal(maxActive, 2);
  assert.equal(result.succeeded.length, CANVAS_VIDEO_RETRY_BATCH_LIMIT - 1);
  assert.deepEqual(result.failed.map(({ log: failedLog, message }) => [failedLog.id, message]), [
    ['video-2', 'provider rejected task'],
  ]);
  assert.equal(progress.length, CANVAS_VIDEO_RETRY_BATCH_LIMIT);
  assert.deepEqual(progress.at(-1), [CANVAS_VIDEO_RETRY_BATCH_LIMIT, CANVAS_VIDEO_RETRY_BATCH_LIMIT]);
  assert.equal(logs.length, CANVAS_VIDEO_RETRY_BATCH_LIMIT + 2);
  assert.equal(logs[2].status, 'error');
});

test('empty candidate queues do not run retry or progress callbacks', async () => {
  let called = false;
  const result = await retryCanvasVideoLogs(
    [log('uncertain', { errorCode: 'provider_result_unconfirmed' })],
    async () => { called = true; },
    () => { called = true; },
  );

  assert.deepEqual(result, { succeeded: [], failed: [] });
  assert.equal(called, false);
});

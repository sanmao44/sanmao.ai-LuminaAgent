import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  CANVAS_UPSCALE_RETRY_BATCH_LIMIT,
  canRetryCanvasUpscaleLog,
  retryCanvasUpscaleLogs,
  retryableCanvasUpscaleLogs,
} = createTsRequire(process.cwd())('./lib/canvas/batch-upscale-retry');

const log = (id, overrides = {}) => ({
  id,
  taskId: `task-${id}`,
  status: 'error',
  mode: 'upscale',
  prompt: `prompt-${id}`,
  errorCode: 'INVALID_IMAGE',
  retryDisposition: 'explicit_rejection',
  ...overrides,
});

test('超分批量候选只包含有明确拒绝标记且无服务商结果的任务', () => {
  const candidates = [
    log('safe'),
    log('duplicate', { taskId: 'task-safe' }),
    log('unknown', { retryDisposition: 'unknown' }),
    log('ambiguous-code', { errorCode: 'UPSTREAM_ERROR' }),
    log('provider-task', { providerTaskId: 'provider-1' }),
    log('has-output', { imageUrls: ['/result.png'] }),
    log('cancelled', { errorCode: 'CANCELLED' }),
    log('video', { mode: 'video' }),
    log('missing-task-id', { taskId: undefined }),
  ];

  assert.equal(canRetryCanvasUpscaleLog(candidates[0]), true);
  assert.equal(canRetryCanvasUpscaleLog(candidates[2]), false);
  assert.deepEqual(retryableCanvasUpscaleLogs(candidates).map(({ id }) => id), ['safe']);
});

test('previously submitted upscale tasks do not consume the batch limit', () => {
  const candidates = Array.from(
    { length: CANVAS_UPSCALE_RETRY_BATCH_LIMIT + 2 },
    (_, index) => log(`item-${index}`),
  );
  const alreadyRetried = new Set(candidates.slice(0, CANVAS_UPSCALE_RETRY_BATCH_LIMIT).map(({ taskId }) => taskId));

  assert.deepEqual(
    retryableCanvasUpscaleLogs(candidates, alreadyRetried).map(({ id }) => id),
    ['item-8', 'item-9'],
  );
});

test('超分批量执行最多八项、并发两项，并逐项报告失败', async () => {
  const logs = Array.from({ length: CANVAS_UPSCALE_RETRY_BATCH_LIMIT + 2 }, (_, index) => log(`item-${index}`));
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const result = await retryCanvasUpscaleLogs(logs, async (task) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (task.id === 'item-3') throw new Error('provider rejected task');
  }, (completed, total) => progress.push([completed, total]));

  assert.equal(maxActive, 2);
  assert.equal(result.succeeded.length, CANVAS_UPSCALE_RETRY_BATCH_LIMIT - 1);
  assert.deepEqual(result.failed.map(({ log: failedLog, message }) => [failedLog.id, message]), [
    ['item-3', 'provider rejected task'],
  ]);
  assert.equal(progress.length, CANVAS_UPSCALE_RETRY_BATCH_LIMIT);
  assert.deepEqual(progress.at(-1), [CANVAS_UPSCALE_RETRY_BATCH_LIMIT, CANVAS_UPSCALE_RETRY_BATCH_LIMIT]);
});

test('没有可确认重提的超分任务时不触发提交或进度', async () => {
  let called = false;
  const result = await retryCanvasUpscaleLogs(
    [log('unknown', { retryDisposition: 'unknown' })],
    async () => { called = true; },
    () => { called = true; },
  );

  assert.deepEqual(result, { succeeded: [], failed: [] });
  assert.equal(called, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const sourceTask = {
  id: 'upscale-task-1',
  status: 'failed',
  errorCode: 'INVALID_IMAGE',
  retryDisposition: 'explicit_rejection',
  reference: '/stored/source.png',
};

function createHarness(claimResult = {
  claimed: true,
  task: sourceTask,
  retryAttempt: 2,
  claimedAt: 123,
}) {
  const calls = [];
  const worker = createTsRequire(process.cwd(), {
    '../../lib/video-task-service': {},
    '../../lib/upscale-service': {
      cancelUpscaleTask: async () => null,
      retryUpscaleTask: async (id) => {
        calls.push(['manual-retry', id]);
        return { id: 'manual-child', retryOf: id };
      },
      retryFailedUpscaleTask: async (task, key) => {
        calls.push(['batch-retry-service', task.id, key]);
        return { id: 'batch-child', retryOf: task.id, status: 'processing' };
      },
      refreshUpscaleTask: async () => null,
    },
    './video-task': {},
    './task-entry': {},
    '../../lib/clone/pipeline': {},
    '../../lib/clone/store': {},
    '../../lib/clone/task-runtime': {},
    '../../lib/generation-log': {},
    '../../lib/video-task-store': {},
    '../../lib/upscale-task-store': {
      claimFailedUpscaleTaskRetry: async (id) => {
        calls.push(['claim-retry', id]);
        return claimResult;
      },
      findUpscaleTask: async () => null,
      releaseFailedUpscaleTaskRetry: async (id, claimedAt) => {
        calls.push(['release-retry', id, claimedAt]);
        return true;
      },
      updateUpscaleTask: async () => null,
    },
    '../../lib/video-task-runtime': {},
    '../../lib/video-task-output': {},
    '../../lib/upscale-task-output': { upscaleTaskOutputUrl: () => '' },
    '../../lib/upscale-task-runtime': { upscaleTaskRuntime: { isActive: () => false } },
    './task-lifecycle': { runTaskLifecycle: async (_kind, _id, operation) => operation() },
  })('./apps/worker/task-control');

  const route = createTsRequire(process.cwd(), {
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/upscale-service': { publicUpscaleTask: (task) => task },
    '@/lib/upscale-catalog': { getUpscaleCatalogModel: () => null },
    '@/apps/worker/task-control': worker,
  })('./app/api/upscale/tasks/[id]/route');
  const patch = (action) => route.PATCH(
    new Request(`http://localhost/api/upscale/tasks/${sourceTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: sourceTask.id }) },
  );
  return { calls, patch };
}

test('超分批量重试经 Worker claim 使用稳定 attempt key，且总会释放 claim', async () => {
  const { calls, patch } = createHarness();
  const response = await patch('retry-failed');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    task: { id: 'batch-child', retryOf: sourceTask.id, status: 'processing' },
  });
  assert.deepEqual(calls, [
    ['claim-retry', sourceTask.id],
    ['batch-retry-service', sourceTask.id, `canvas-upscale-retry:${sourceTask.id}:2`],
    ['release-retry', sourceTask.id, 123],
  ]);
});

test('超分批量重试遇到过期或状态不明的任务返回 409，不调用提交服务', async () => {
  const { calls, patch } = createHarness({ claimed: false, reason: 'not_retryable' });
  const response = await patch('retry-failed');

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /已确认拒绝/u);
  assert.deepEqual(calls, [['claim-retry', sourceTask.id]]);
});

test('旧的手动超分重试仍使用独立 action', async () => {
  const { calls, patch } = createHarness();
  const response = await patch('retry');

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['manual-retry', sourceTask.id]]);
});

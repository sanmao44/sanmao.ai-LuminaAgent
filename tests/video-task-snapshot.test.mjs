import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const pendingTask = {
  id: 'local-video-1',
  status: 'pending',
  providerId: 'provider-1',
  modelId: 'model-1',
  input: { prompt: 'A quiet landscape' },
};

function createHarness(task = pendingTask, trusted = true, claimResult = { claimed: true, task: { ...pendingTask, status: 'failed' }, retryAttempt: 1, claimedAt: 123 }) {
  const calls = [];
  const worker = createTsRequire(process.cwd(), {
    '../../lib/video-task-store': {
      claimFailedVideoTaskRetry: async (id) => {
        calls.push(['claim-retry', id]);
        return claimResult;
      },
      findVideoTask: async (id) => {
        calls.push(['find', id]);
        return task;
      },
      releaseFailedVideoTaskRetry: async (id, claimedAt) => {
        calls.push(['release-retry', id, claimedAt]);
        return true;
      },
      updateVideoTask: async (id, patch) => {
        calls.push(['update', id, patch]);
        return { ...task, ...patch };
      },
    },
    '../../lib/video-task-service': {
      retryVideoTask: async (id) => {
        calls.push(['manual-retry', id]);
        return { id: 'manual-retry-task', retryOf: id, status: 'pending' };
      },
      retryFailedVideoTask: async (source, key) => {
        calls.push(['batch-retry-service', source.id, key]);
        return { id: 'batch-retry-task', retryOf: source.id, status: 'pending' };
      },
      refreshVideoTask: async (id) => {
        calls.push(['provider-refresh', id]);
        return { ...task, status: 'running', providerTaskId: 'upstream-video-1' };
      },
    },
    './video-task': {
      refreshVideoTask: async (id, refresh) => {
        calls.push(['refresh', id]);
        return refresh();
      },
    },
    '../../lib/upscale-service': {},
    './task-entry': {},
    '../../lib/clone/pipeline': {},
    '../../lib/clone/store': {},
    '../../lib/clone/task-runtime': {},
    '../../lib/generation-log': {},
    '../../lib/upscale-task-store': {},
    '../../lib/upscale-task-output': {},
    '../../lib/upscale-task-runtime': {},
    './task-lifecycle': { runTaskLifecycle: async (_identity, _id, operation) => operation() },
  })('./apps/worker/task-control');
  const route = createTsRequire(process.cwd(), {
    '@/lib/auth': { isTrustedAppRequest: () => trusted },
    '@/apps/worker/task-control': worker,
  })('./app/api/video/tasks/[id]/route');
  const get = (query = '') => route.GET(
    new Request(`http://localhost/api/video/tasks/${pendingTask.id}${query}`),
    { params: Promise.resolve({ id: pendingTask.id }) },
  );
  const patch = (action) => route.PATCH(
    new Request(`http://localhost/api/video/tasks/${pendingTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: pendingTask.id }) },
  );
  return { worker, calls, get, patch };
}

test('video snapshot reads pending tasks without submitting or refreshing the provider', async () => {
  const { worker, calls } = createHarness();

  assert.equal(await worker.getVideoTaskSnapshot(pendingTask.id), pendingTask);
  assert.deepEqual(calls, [['find', pendingTask.id]]);
  assert.equal(pendingTask.providerTaskId, undefined);
});

test('video snapshot preserves stored status when saved output could be projected as complete', async () => {
  const task = { ...pendingTask, status: 'running', videoUrls: ['/api/storage/video?name=result.mp4'] };
  const { worker, calls } = createHarness(task);

  assert.equal(await worker.getVideoTaskSnapshot(task.id), task);
  assert.equal(task.status, 'running');
  assert.deepEqual(calls, [['find', task.id]]);
});

test('video snapshot returns null for a missing task', async () => {
  const { worker, calls } = createHarness(null);

  assert.equal(await worker.getVideoTaskSnapshot('missing-task'), null);
  assert.deepEqual(calls, [['find', 'missing-task']]);
});

test('batch retry uses the Worker claim and stable attempt key', async () => {
  const { calls, patch } = createHarness();
  const response = await patch('retry-failed');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    task: { id: 'batch-retry-task', retryOf: pendingTask.id, status: 'pending' },
  });
  assert.deepEqual(calls, [
    ['claim-retry', pendingTask.id],
    ['batch-retry-service', pendingTask.id, `canvas-video-retry:${pendingTask.id}:1`],
    ['release-retry', pendingTask.id, 123],
  ]);
});

test('batch retry maps a stale or completed source task to conflict without provider submission', async () => {
  const { calls, patch } = createHarness(pendingTask, true, { claimed: false, reason: 'not_retryable' });
  const response = await patch('retry-failed');

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /状态已变化/u);
  assert.deepEqual(calls, [['claim-retry', pendingTask.id]]);
});

test('legacy manual retry remains a separate Worker action', async () => {
  const { calls, patch } = createHarness();
  const response = await patch('retry');

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['manual-retry', pendingTask.id]]);
});

test('video GET refresh=false returns a stored snapshot with no lifecycle work', async () => {
  const { calls, get } = createHarness();
  const response = await get('?refresh=false');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { task: pendingTask });
  assert.deepEqual(calls, [['find', pendingTask.id]]);
});

for (const query of ['', '?refresh=true', '?refresh=0']) {
  test(`video GET ${query || 'without a query'} keeps the existing refresh behavior`, async () => {
    const { calls, get } = createHarness();
    const response = await get(query);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).task.status, 'running');
    assert.deepEqual(calls, [
      ['find', pendingTask.id],
      ['refresh', pendingTask.id],
      ['provider-refresh', pendingTask.id],
    ]);
  });
}

for (const query of ['?refresh=false']) {
  test(`video GET ${query} reads a snapshot without lifecycle work`, async () => {
    const { calls, get } = createHarness();
    const response = await get(query);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { task: pendingTask });
    assert.deepEqual(calls, [['find', pendingTask.id]]);
  });
}

for (const query of ['', '?refresh=false']) {
  test(`video GET rejects untrusted requests before reading a task ${query}`, async () => {
    const { calls, get } = createHarness(pendingTask, false);
    const response = await get(query);

    assert.equal(response.status, 401);
    assert.deepEqual(calls, []);
  });

  test(`video GET reports a missing task ${query}`, async () => {
    const { calls, get } = createHarness(null);
    const response = await get(query);

    assert.equal(response.status, 404);
    assert.deepEqual(calls, [['find', pendingTask.id]]);
  });
}

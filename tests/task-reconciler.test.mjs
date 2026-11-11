import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLibModules } from './lib-build.mjs';
import { createTsRequire } from './ts-require.mjs';

function loadReconciler(dependencies) {
  return createTsRequire(process.cwd(), {
    './task-control': {
      refreshVideoTask: dependencies.refreshVideoTask,
      refreshUpscaleTask: dependencies.refreshUpscaleTask,
    },
    '../../lib/video-task-store': { listRunnableVideoTasks: dependencies.listRunnableVideoTasks },
    '../../lib/upscale-task-store': { listRunnableUpscaleTasks: dependencies.listRunnableUpscaleTasks },
  })('./apps/worker/task-reconciler');
}

test('reconciler balances task types, bounds concurrency, and isolates failures', async () => {
  let active = 0;
  let maximumActive = 0;
  const refreshed = [];
  const errors = [];
  const dependencies = {
    listRunnableVideoTasks: async (now, limit) => {
      assert.equal(now, 1234);
      assert.equal(limit, 3);
      return [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }];
    },
    listRunnableUpscaleTasks: async (now, limit) => {
      assert.equal(now, 1234);
      assert.equal(limit, 3);
      return [{ id: 'u1' }, { id: 'u2' }];
    },
    refreshVideoTask: async (id) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      refreshed.push(`video:${id}`);
      if (id === 'v2') throw new Error('provider unavailable');
    },
    refreshUpscaleTask: async (id) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      refreshed.push(`upscale:${id}`);
    },
    onTaskError: (task, error) => errors.push([task.kind, task.id, error.message]),
  };
  const { reconcileDueTasks } = loadReconciler(dependencies);
  const result = await reconcileDueTasks(dependencies, { now: 1234, concurrency: 2, maxTasks: 3 });

  assert.deepEqual(result, { considered: 3, refreshed: 2, failed: 1 });
  assert.equal(maximumActive, 2);
  assert.equal(refreshed.length, 3);
  assert.deepEqual(errors, [['video', 'v2', 'provider unavailable']]);
});

test('upscale task status GET preserves refresh behavior and supports pure snapshots', async () => {
  const calls = [];
  const task = { id: 'upscale-1', model: 'tencent-ci-super-resolution', status: 'processing' };
  const worker = {
    getUpscaleTaskSnapshot: async (id) => { calls.push(['snapshot', id]); return task; },
    getUpscaleTask: async (id) => { calls.push(['refresh', id]); return { ...task, status: 'succeeded' }; },
  };
  const route = createTsRequire(process.cwd(), {
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/upscale-service': { publicUpscaleTask: (value) => value },
    '@/apps/worker/task-control': worker,
    '@/lib/upscale-catalog': { getUpscaleCatalogModel: () => null },
  })('./app/api/upscale/tasks/[id]/route');
  const get = (query = '') => route.GET(
    new Request(`http://localhost/api/upscale/tasks/${task.id}${query}`),
    { params: Promise.resolve({ id: task.id }) },
  );

  const snapshotResponse = await get('?refresh=false');
  assert.equal(snapshotResponse.status, 200);
  assert.equal((await snapshotResponse.json()).task.status, 'processing');
  assert.deepEqual(calls, [['snapshot', task.id]]);

  const refreshedResponse = await get();
  assert.equal(refreshedResponse.status, 200);
  assert.equal((await refreshedResponse.json()).task.status, 'succeeded');
  assert.deepEqual(calls, [['snapshot', task.id], ['refresh', task.id]]);
});

test('due-task queries reach old active jobs beyond recent-list limits', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-task-reconciler-'));
  const previousDataDir = process.env.SANMAO_DATA_DIR;
  process.env.SANMAO_DATA_DIR = dataDir;
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  const now = Date.now();
  const completed = Array.from({ length: 505 }, (_, index) => ({
    id: `video-done-${index}`,
    createdAt: new Date(now - index * 1000).toISOString(),
    status: 'done',
    idempotencyKey: `done-${index}`,
    pollCount: 0,
  }));
  const oldestActive = {
    id: 'old-active-video',
    createdAt: new Date(now - 600_000).toISOString(),
    status: 'running',
    idempotencyKey: 'old-active-video',
    pollCount: 1,
  };
  await writeFile(path.join(dataDir, 'video-tasks.json'), JSON.stringify([...completed, oldestActive]));
  await writeFile(path.join(dataDir, 'upscale-tasks.json'), JSON.stringify([
    {
      id: 'due-upscale', createdAt: new Date(now - 5_000).toISOString(), status: 'processing',
      providerTaskId: 'provider-task', nextPollAt: now - 1, idempotencyKey: 'due', pollCount: 0,
    },
    {
      id: 'future-upscale', createdAt: new Date(now - 5_000).toISOString(), status: 'processing',
      providerTaskId: 'provider-task-future', nextPollAt: now + 30_000, idempotencyKey: 'future', pollCount: 0,
    },
    {
      id: 'orphaned-upscale', createdAt: new Date(now - 21 * 60_000).toISOString(), status: 'processing',
      idempotencyKey: 'orphaned', pollCount: 0,
    },
    {
      id: 'fresh-submission', createdAt: new Date(now - 1_000).toISOString(), status: 'processing',
      idempotencyKey: 'fresh', pollCount: 0,
    },
    {
      id: 'cancelled-upscale', createdAt: new Date(now - 5_000).toISOString(), status: 'cancelled',
      providerTaskId: 'provider-task-cancelled', idempotencyKey: 'cancelled', pollCount: 0,
    },
  ]));

  const { load } = await buildLibModules(
    ['lib/task-store', 'lib/repositories/task-repository', 'lib/video-task-store', 'lib/upscale-task-retry-policy', 'lib/upscale-task-store'],
    'video-task-store',
  );
  const videoStore = await load('video-task-store');
  const upscaleStore = await load('upscale-task-store');

  assert.equal((await videoStore.listVideoTasks(500)).some((task) => task.id === oldestActive.id), false);
  assert.deepEqual((await videoStore.listRunnableVideoTasks(now, 10)).map((task) => task.id), [oldestActive.id]);
  assert.deepEqual(
    (await upscaleStore.listRunnableUpscaleTasks(now, 10)).map((task) => task.id).sort(),
    ['due-upscale', 'orphaned-upscale'],
  );
});

test('reconciler reaches older due tasks across repeated scheduling passes', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-task-reconciler-fairness-'));
  const previousDataDir = process.env.SANMAO_DATA_DIR;
  process.env.SANMAO_DATA_DIR = dataDir;
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  const now = Date.now();
  const count = 14;
  const videoTasks = Array.from({ length: count }, (_, index) => ({
    id: `video-${index}`,
    createdAt: new Date(now - index * 1000).toISOString(),
    status: 'running',
    providerTaskId: `provider-video-${index}`,
    nextPollAt: now - 1,
    idempotencyKey: `video-${index}`,
    pollCount: 0,
  }));
  const upscaleTasks = Array.from({ length: count }, (_, index) => ({
    id: `upscale-${index}`,
    createdAt: new Date(now - index * 1000).toISOString(),
    status: 'processing',
    providerTaskId: `provider-upscale-${index}`,
    nextPollAt: now - 1,
    idempotencyKey: `upscale-${index}`,
    pollCount: 0,
  }));
  await writeFile(path.join(dataDir, 'video-tasks.json'), JSON.stringify(videoTasks));
  await writeFile(path.join(dataDir, 'upscale-tasks.json'), JSON.stringify(upscaleTasks));

  const { load } = await buildLibModules(
    ['lib/task-store', 'lib/repositories/task-repository', 'lib/video-task-store', 'lib/upscale-task-retry-policy', 'lib/upscale-task-store'],
    'video-task-store',
  );
  const videoStore = await load('video-task-store');
  const upscaleStore = await load('upscale-task-store');
  const refreshed = [];
  const dependencies = {
    listRunnableVideoTasks: (at, limit) => videoStore.listRunnableVideoTasks(at, limit),
    listRunnableUpscaleTasks: (at, limit) => upscaleStore.listRunnableUpscaleTasks(at, limit),
    refreshVideoTask: async (id) => {
      refreshed.push(`video:${id}`);
      await videoStore.updateVideoTask(id, { nextPollAt: now + 30_000 });
    },
    refreshUpscaleTask: async (id) => {
      refreshed.push(`upscale:${id}`);
      await upscaleStore.updateUpscaleTask(id, { nextPollAt: now + 30_000 });
    },
  };
  const { reconcileDueTasks } = loadReconciler(dependencies);

  for (let pass = 0; pass < 3; pass += 1) {
    await reconcileDueTasks(dependencies, { now, concurrency: 2, maxTasks: 12 });
  }

  assert.equal(refreshed.length, count * 2);
  assert.equal(new Set(refreshed).size, count * 2);
  assert.deepEqual(new Set(refreshed), new Set([
    ...videoTasks.map((task) => `video:${task.id}`),
    ...upscaleTasks.map((task) => `upscale:${task.id}`),
  ]));
});

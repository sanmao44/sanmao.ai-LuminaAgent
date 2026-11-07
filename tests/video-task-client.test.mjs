import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  deleteVideoTask,
  getVideoTask,
  listVideoTasksPage,
  patchVideoTask,
  saveVideoTaskLocally,
} = createTsRequire(process.cwd())('./lib/video-task-client');

const originalFetch = globalThis.fetch;

function mockResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

function videoTask(overrides = {}) {
  return {
    id: 'task/视频 1', providerId: 'provider-1', modelId: 'model-1',
    operation: 'generate', status: 'done', idempotencyKey: 'request-1',
    input: { prompt: 'A cat', seconds: 5, referenceImages: ['/reference.png'] },
    videoUrls: ['/video.mp4'], remoteVideoUrls: [], localVideoPaths: [],
    createdAt: '2026-11-07T00:00:00.000Z', pollCount: 1,
    ...overrides,
  };
}

test('video task client reads an encoded task snapshot without refreshing execution or caching', async () => {
  let request;
  const task = videoTask();
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return Response.json({ task });
  };
  assert.deepEqual(await getVideoTask(task.id), task);
  assert.equal(request.input, `/api/video/tasks/${encodeURIComponent(task.id)}?refresh=false`);
  assert.deepEqual(request.init, { cache: 'no-store' });
});

test('video task client passes cancellation to the snapshot request', async () => {
  const controller = new AbortController();
  const task = videoTask();
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return Response.json({ task });
  };
  await getVideoTask(task.id, { signal: controller.signal });
  assert.equal(request.init.signal, controller.signal);
  assert.equal(request.init.cache, 'no-store');
});

test('video task client treats a missing snapshot as absent', async () => {
  globalThis.fetch = async () => new Response('missing', { status: 404 });
  assert.equal(await getVideoTask('missing'), null);
});

test('video task client reports authentication and server errors instead of a missing task', async () => {
  for (const [status, error] of [[401, '需要管理员登录。'], [500, '任务存储暂不可用']]) {
    globalThis.fetch = async () => Response.json({ error }, { status });
    await assert.rejects(getVideoTask('task-1'), { message: error });
  }
  globalThis.fetch = async () => new Response('bad gateway', { status: 500 });
  await assert.rejects(getVideoTask('task-1'), { message: '读取视频任务失败' });
});

test('video task client rejects invalid or mismatched snapshots before restoring a form', async () => {
  const task = videoTask();
  const invalidBodies = [
    null, {}, { task: null }, { task: [] }, { task: { id: task.id } },
    { task: videoTask({ id: 'another-task' }) },
    { task: videoTask({ status: 'unknown' }) },
    { task: videoTask({ operation: 'unknown' }) },
    { task: videoTask({ input: {} }) },
    { task: videoTask({ input: { prompt: 10 } }) },
    { task: videoTask({ videoUrls: 'invalid' }) },
  ];
  for (const body of invalidBodies) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(getVideoTask(task.id), { message: '视频任务响应无效，请稍后重试' });
  }
  globalThis.fetch = async () => new Response('{invalid json', { status: 200 });
  await assert.rejects(getVideoTask(task.id), { message: '视频任务响应无效，请稍后重试' });
});

test('video task client preserves paged list query and response normalization', async () => {
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return mockResponse({ tasks: [{ id: 'one' }], total: '3', page: '2' });
  };
  assert.deepEqual(await listVideoTasksPage({ page: 2, pageSize: 12, source: 'canvas', media: 'video', search: '  cat  ' }), {
    tasks: [{ id: 'one' }],
    total: 3,
    page: 2,
  });
  assert.equal(request.input, '/api/video/tasks?page=2&pageSize=12&source=canvas&media=video&search=cat');
  assert.deepEqual(request.init, { cache: 'no-store' });
});

test('video task client preserves task control methods and payloads', async () => {
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return mockResponse({ task: { id: 'task/1', status: 'cancelled' }, ok: true });
  };
  await deleteVideoTask('task/1');
  await patchVideoTask('task/1', 'cancel');
  await saveVideoTaskLocally('task/1');
  assert.equal(requests[0].input, '/api/video/tasks/task%2F1');
  assert.equal(requests[0].init.method, 'DELETE');
  assert.equal(JSON.parse(requests[1].init.body).action, 'cancel');
  assert.equal(requests[2].init.method, 'POST');
});

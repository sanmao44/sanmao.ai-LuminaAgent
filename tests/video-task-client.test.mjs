import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  deleteVideoTask,
  listVideoTasksPage,
  patchVideoTask,
  saveVideoTaskLocally,
} = createTsRequire(process.cwd())('./lib/video-task-client');

const originalFetch = globalThis.fetch;

function mockResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

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

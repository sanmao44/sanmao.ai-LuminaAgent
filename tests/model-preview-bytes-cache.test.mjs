import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const previewCache = createTsRequire(process.cwd())('./components/cangyuan/model-preview-bytes-cache');

function createResponse(bytes) {
  return new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength) } });
}

test('model preview bytes are reused from bounded memory cache', async () => {
  let fetchCount = 0;
  const source = new Uint8Array([1, 2, 3, 4]);
  const cache = previewCache.createModelPreviewBytesCache({
    fetchResponse: async () => { fetchCount += 1; return createResponse(source); },
  });
  const progress = [];

  const first = await cache.load('/preview/task-1/0', (value) => progress.push(value));
  const second = await cache.load('/preview/task-1/0');

  assert.equal(fetchCount, 1);
  assert.strictEqual(second, first);
  assert.equal(progress.at(-1).percentage, 100);
});

test('concurrent model preview requests share one upstream fetch', async () => {
  let fetchCount = 0;
  let releaseFetch;
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
  const source = new Uint8Array([5, 6, 7]);
  const cache = previewCache.createModelPreviewBytesCache({
    fetchResponse: async () => {
      fetchCount += 1;
      await fetchGate;
      return createResponse(source);
    },
  });

  const firstPromise = cache.load('/preview/task-2/0');
  const secondPromise = cache.load('/preview/task-2/0');
  releaseFetch();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(fetchCount, 1);
  assert.strictEqual(second, first);
});

test('least recently used entries are evicted when the memory limit is reached', async () => {
  const fetchCounts = new Map();
  const cache = previewCache.createModelPreviewBytesCache({
    maxEntries: 2,
    maxBytes: 6,
    fetchResponse: async (url) => {
      fetchCounts.set(url, (fetchCounts.get(url) || 0) + 1);
      return createResponse(new Uint8Array([1, 2, 3]));
    },
  });

  await cache.load('/preview/a/0');
  await cache.load('/preview/b/0');
  await cache.load('/preview/a/0');
  await cache.load('/preview/c/0');
  await cache.load('/preview/a/0');
  await cache.load('/preview/b/0');

  assert.equal(fetchCounts.get('/preview/a/0'), 1);
  assert.equal(fetchCounts.get('/preview/b/0'), 2);
  assert.equal(fetchCounts.get('/preview/c/0'), 1);
});

test('oversized GLB previews are displayed without entering the session cache', async () => {
  const fetchCounts = new Map();
  const cache = previewCache.createModelPreviewBytesCache({
    maxBytes: 3,
    fetchResponse: async (url) => {
      fetchCounts.set(url, (fetchCounts.get(url) || 0) + 1);
      return createResponse(new Uint8Array([1, 2, 3, 4]));
    },
  });

  await cache.load('/preview/large/0');
  await cache.load('/preview/large/0');

  assert.equal(fetchCounts.get('/preview/large/0'), 2);
});

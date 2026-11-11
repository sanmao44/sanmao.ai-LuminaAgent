import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/video-storage.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);

function loadVideoStorage(dataDir) {
  // 媒体库根固定在临时目录内，避免测试写进真实用户目录。
  process.env.SANMAO_DATA_DIR = dataDir;
  process.env.SANMAO_MEDIA_ROOT = dataDir;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(requireTs, module, module.exports);
  return module.exports;
}

const video = Buffer.from('not-a-real-video-but-a-persistable-provider-payload');

test('stores provider video bytes under a local storage URL', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadVideoStorage(dataDir);
  globalThis.fetch = async () => new Response(video, {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });
  try {
    const result = await storage.persistGeneratedVideos([{ url: 'https://provider.example/result.mp4' }]);
    assert.equal(result.storageError, undefined);
    assert.match(result.videos[0].url, /^\/api\/storage\/video\?name=/);
    const name = new URL(`http://sanmao.local${result.videos[0].url}`).searchParams.get('name');
    assert.ok(name);
    assert.deepEqual([...await readFile(path.join(dataDir, 'videos', name))], [...video]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('retries a transient network failure and stores the successful response', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadVideoStorage(dataDir);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response(video, { status: 200, headers: { 'content-type': 'video/mp4' } });
  };
  try {
    const result = await storage.persistGeneratedVideos([{ url: 'https://provider.example/retry.mp4' }]);
    assert.equal(calls, 2);
    assert.equal(result.storageError, undefined);
    assert.equal(result.videos.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('retries rate limits and honors a bounded Retry-After delay', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadVideoStorage(dataDir);
  let calls = 0;
  const startedAt = Date.now();
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response('slow down', { status: 429, headers: { 'retry-after': '0.04' } })
      : new Response(video, { status: 200, headers: { 'content-type': 'video/mp4' } });
  };
  try {
    const result = await storage.persistGeneratedVideos([{ url: 'https://provider.example/rate-limited.mp4' }]);
    assert.equal(calls, 2);
    assert.ok(Date.now() - startedAt >= 30);
    assert.equal(result.storageError, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('retries server errors up to the attempt limit and reports the final status', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadVideoStorage(dataDir);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('unavailable', { status: 503 });
  };
  try {
    const result = await storage.persistGeneratedVideos([{ url: 'https://provider.example/unavailable.mp4' }]);
    assert.equal(calls, 3);
    assert.deepEqual(result.videos, []);
    assert.match(result.storageError, /HTTP 503/);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('does not retry authorization or missing-result errors', async () => {
  for (const status of [401, 404, 410]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
    const previousFetch = globalThis.fetch;
    const storage = loadVideoStorage(dataDir);
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('unavailable', { status });
    };
    try {
      const result = await storage.persistGeneratedVideos([{ url: 'https://provider.example/unavailable.mp4' }]);
      assert.equal(calls, 1, `HTTP ${status} should fail without retrying`);
      assert.match(result.storageError, new RegExp(`HTTP ${status}`));
    } finally {
      globalThis.fetch = previousFetch;
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});

test('does not return remote URLs or leave partial files when one video cannot be saved', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadVideoStorage(dataDir);
  globalThis.fetch = async (url) => String(url).endsWith('/bad.mp4')
    ? new Response('expired', { status: 410 })
    : new Response(video, { status: 200, headers: { 'content-type': 'video/mp4' } });
  try {
    const result = await storage.persistGeneratedVideos([
      { url: 'https://provider.example/good.mp4' },
      { url: 'https://provider.example/bad.mp4' },
    ]);
    assert.deepEqual(result.videos, []);
    assert.match(result.storageError, /本地视频保存失败.*HTTP 410/);
    assert.deepEqual(await readdir(path.join(dataDir, 'videos')), []);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('rejects unsupported video references instead of passing them through', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-storage-'));
  const storage = loadVideoStorage(dataDir);
  try {
    const result = await storage.persistGeneratedVideos([{ url: '/temporary/video.mp4' }]);
    assert.deepEqual(result.videos, []);
    assert.match(result.storageError, /不是可读取的 data URL 或 HTTP 地址/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

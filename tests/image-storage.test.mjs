import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/image-storage.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);

function loadImageStorage(dataDir) {
  // 媒体库根固定在临时目录内，避免测试写进真实用户目录。
  process.env.SANMAO_DATA_DIR = dataDir;
  process.env.SANMAO_MEDIA_ROOT = dataDir;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(requireTs, module, module.exports);
  return module.exports;
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('rejects an upstream response whose bytes are not an image and leaves no partial file', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  globalThis.fetch = async (url) => url.endsWith('/bad.png')
    ? new Response(Buffer.from('upstream-error'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    : new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  try {
    await assert.rejects(
      storage.persistGeneratedImages([
        { url: 'https://provider.example/good.png' },
        { url: 'https://provider.example/bad.png' },
      ]),
      /本地图片保存失败.*不是有效的.*图片/,
    );
    assert.deepEqual(await readdir(path.join(dataDir, 'images')), []);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('stores valid image bytes under a local storage URL', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  globalThis.fetch = async () => new Response(png, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  try {
    const result = await storage.persistGeneratedImages([{ url: 'https://provider.example/result.png' }]);
    assert.match(result.images[0].url, /^\/api\/storage\/file\?name=/);
    const name = new URL(`http://sanmao.local${result.images[0].url}`).searchParams.get('name');
    assert.ok(name);
    assert.deepEqual([...await readFile(path.join(dataDir, 'images', name))], [...png]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('sends provider auth only to a trusted provider host', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    await storage.persistGeneratedImages([
      { url: 'https://provider.example/result.png' },
      { url: 'https://cdn.example/result.png' },
    ], undefined, {
      headers: { Authorization: 'Bearer secret' },
      trustedHosts: ['provider.example'],
    });
    assert.deepEqual(calls.find(call => call.url.includes('provider.example')).headers, { Authorization: 'Bearer secret' });
    assert.deepEqual(calls.find(call => call.url.includes('cdn.example')).headers, {});
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('reports safe upstream response metadata for invalid image bytes', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  globalThis.fetch = async () => new Response(Buffer.from('upstream-error'), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  try {
    await assert.rejects(
      storage.persistGeneratedImages([{ url: 'https://provider.example/result.png?signature=secret' }]),
      /来源 provider\.example，HTTP 200，Content-Type text\/html/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('drops provider auth after a cross-host redirect', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://cdn.example/result.png' } });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    await storage.persistGeneratedImages([{ url: 'https://provider.example/result.png' }], undefined, {
      headers: { Authorization: 'Bearer secret' },
      trustedHosts: ['provider.example'],
    });
    assert.deepEqual(calls[0].headers, { Authorization: 'Bearer secret' });
    assert.deepEqual(calls[1].headers, {});
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('allows only the configured 65535 service subdomains', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    await storage.persistGeneratedImages([
      { url: 'https://image-cdn.65535.space/result.png' },
      { url: 'https://not65535.space/result.png' },
    ], undefined, {
      headers: { Authorization: 'Bearer secret' },
      trustedHosts: ['task-api-1-cn.65535.space'],
      trustedHostSuffixes: ['65535.space'],
    });
    assert.deepEqual(calls.find(call => call.url.includes('image-cdn.65535.space')).headers, { Authorization: 'Bearer secret' });
    assert.deepEqual(calls.find(call => call.url.includes('not65535.space')).headers, {});
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('accepts a provider JSON wrapper and retries a signed URL without auth', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    if (String(url).includes('/result.json')) {
      return new Response(JSON.stringify({ data: [{ image_url: 'https://image-cdn.65535.space/result.png?signature=abc' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (Object.keys(init.headers || {}).length) return new Response('signed URL does not accept Authorization', { status: 403, headers: { 'content-type': 'text/plain' } });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const result = await storage.persistGeneratedImages([{ url: 'https://provider.example/result.json' }], undefined, {
      headers: { Authorization: 'Bearer secret' },
      trustedHosts: ['provider.example'],
      trustedHostSuffixes: ['65535.space'],
    });
    assert.match(result.images[0].url, /^\/api\/storage\/file\?name=/);
    assert.deepEqual(calls.map((call) => call.headers), [
      { Authorization: 'Bearer secret' },
      { Authorization: 'Bearer secret' },
      {},
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('accepts raw base64 image content returned by a provider URL', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  globalThis.fetch = async () => new Response(png.toString('base64'), {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
  try {
    const result = await storage.persistGeneratedImages([{ url: 'https://provider.example/base64-result' }]);
    assert.match(result.images[0].url, /^\/api\/storage\/file\?name=/);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('retries transient provider download failures before saving the image', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('busy', { status: 503 });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const result = await storage.persistGeneratedImages([{ url: 'https://provider.example/result.png' }]);
    assert.equal(calls, 2);
    assert.match(result.images[0].url, /^\/api\/storage\/file\?name=/);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('preserves a provider image URL when local archival cannot download it', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-storage-'));
  const previousFetch = globalThis.fetch;
  const storage = loadImageStorage(dataDir);
  const providerUrl = 'https://provider.example/result.png?signature=temporary';
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  try {
    const result = await storage.persistGeneratedImages([{ url: providerUrl }], undefined, undefined, { preserveRemoteImages: true });
    assert.deepEqual(result.images, [{ url: providerUrl }]);
    assert.equal(result.remoteFallbacks.length, 1);
    assert.equal(result.remoteFallbacks[0].index, 0);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
});

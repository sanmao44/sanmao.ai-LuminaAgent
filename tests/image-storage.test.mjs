import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/image-storage.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const require = createRequire(import.meta.url);

function loadImageStorage(dataDir) {
  const previous = process.env.SANMAO_DATA_DIR;
  process.env.SANMAO_DATA_DIR = dataDir;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  if (previous === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previous;
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

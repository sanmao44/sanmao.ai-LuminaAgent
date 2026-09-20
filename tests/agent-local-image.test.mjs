import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const requireTs = createTsRequire(fileURLToPath(new URL('../lib', import.meta.url)));
const { importLocalImage, isLocalImageRead } = requireTs('./agent/local-image');

test('authorized local images use a stored URL, not a base64 message', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sanmao-local-image-'));
  try {
    const root = path.join(base, 'allowed');
    await mkdir(root);
    const target = path.join(root, 'INTJ.png');
    const bytes = Buffer.alloc(1800000, 1);
    await writeFile(target, bytes);
    let received;
    const result = await importLocalImage(target, { roots: [root] }, async (data) => {
      received = data;
      return { url: '/api/storage/file?name=stored.png' };
    });
    assert.deepEqual(received, bytes);
    assert.equal(result.url, '/api/storage/file?name=stored.png');
    assert.equal(result.size, bytes.length);
    assert.equal(JSON.stringify(result).includes('base64'), false);
    await assert.rejects(importLocalImage(target, { roots: [] }, () => assert.fail('no save outside authorized directories')), /授权/);
    await assert.rejects(importLocalImage(target, { roots: [root], dataDir: root }, () => assert.fail('no private data')), /数据目录/);
    const secret = path.join(root, '.ssh');
    await mkdir(secret);
    await writeFile(path.join(secret, 'key.png'), bytes);
    await assert.rejects(importLocalImage(path.join(secret, 'key.png'), { roots: [root] }, () => assert.fail('no private key')), /凭据|私钥/);
    await writeFile(path.join(root, 'empty.png'), '');
    await assert.rejects(importLocalImage(path.join(root, 'empty.png'), { roots: [root] }, () => assert.fail()), /32MB/);
    await assert.rejects(importLocalImage(target, { roots: [root] }, async () => { throw new Error('invalid image'); }), /invalid image/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('only supported image reads use the local image path', () => {
  assert.equal(isLocalImageRead('read_media_file', { path: 'C:\\images\\INTJ.png' }), true);
  assert.equal(isLocalImageRead('read_file', { path: '/images/a.jpg' }), true);
  assert.equal(isLocalImageRead('move_file', { path: '/images/a.png' }), false);
  assert.equal(isLocalImageRead('read_media_file', { path: '/images/a.svg' }), false);
});

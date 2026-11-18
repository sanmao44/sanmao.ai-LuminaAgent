import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

test('serves stored SVG previews with a safe content policy and exact MIME type', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-svg-route-'));
  const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><circle r="1"/></svg>');
  await writeFile(path.join(root, 'vector.svg'), source);
  const requireTs = createTsRequire(process.cwd(), {
    '@/lib/media-library': { ensureMediaLibrary: async () => undefined },
    '@/lib/store': { getPublicState: async () => ({ settings: { imageStoragePath: root } }) },
    '@/lib/auth': { isTrustedAppRequest: () => true },
  });
  const route = requireTs('./app/api/storage/file/route');
  try {
    const response = await route.GET(new Request('http://localhost/api/storage/file?name=vector.svg'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /sandbox; default-src 'none'/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

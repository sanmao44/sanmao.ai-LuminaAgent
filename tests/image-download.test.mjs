import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const downloader = createTsRequire(process.cwd())('./lib/image-download');

function installBrowserFakes() {
  const original = { fetch: globalThis.fetch, document: globalThis.document, URL: globalThis.URL, window: globalThis.window };
  const anchors = [];
  const revoked = [];
  globalThis.document = {
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a');
      const anchor = { click() { this.clicked = true; }, remove() {} };
      anchors.push(anchor);
      return anchor;
    },
  };
  globalThis.URL = { createObjectURL(blob) { return `blob:${blob.type}`; }, revokeObjectURL(url) { revoked.push(url); } };
  globalThis.window = { setTimeout(callback) { callback(); } };
  return { original, anchors, revoked };
}

function restoreBrowserFakes(original) {
  globalThis.fetch = original.fetch;
  globalThis.document = original.document;
  globalThis.URL = original.URL;
  globalThis.window = original.window;
}

test('normalizes fetched image extensions and revokes the temporary URL', async () => {
  const { original, anchors, revoked } = installBrowserFakes();
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
    await downloader.downloadImage('/generated', 'SANMAO-image.png');
    assert.equal(anchors[0].download, 'SANMAO-image.jpg');
    assert.equal(anchors[0].clicked, true);
    assert.deepEqual(revoked, ['blob:image/jpeg']);
  } finally {
    restoreBrowserFakes(original);
  }
});

test('falls back to a data URL download when fetching fails', async () => {
  const { original, anchors } = installBrowserFakes();
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    await downloader.downloadImage('data:image/webp;base64,AAAA', 'SANMAO-image.png');
    assert.equal(anchors[0].href, 'data:image/webp;base64,AAAA');
    assert.equal(anchors[0].download, 'SANMAO-image.webp');
    assert.equal(anchors[0].target, '_blank');
    assert.equal(anchors[0].rel, 'noreferrer');
  } finally {
    restoreBrowserFakes(original);
  }
});

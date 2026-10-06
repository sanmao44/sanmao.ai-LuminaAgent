import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const downloader = createTsRequire(process.cwd())('./lib/agent/chat-file-download');

function installBrowserFakes() {
  const original = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    URL: globalThis.URL,
    window: globalThis.window,
  };
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
  globalThis.URL = { createObjectURL(value) { return `blob:${value.type || 'file'}`; }, revokeObjectURL(value) { revoked.push(value); } };
  globalThis.window = { setTimeout(callback) { callback(); } };
  return { original, anchors, revoked };
}

function restoreBrowserFakes(original) {
  globalThis.fetch = original.fetch;
  globalThis.document = original.document;
  globalThis.URL = original.URL;
  globalThis.window = original.window;
}

test('downloads inline base64 chat files with the persisted filename and mime type', async () => {
  const { original, anchors } = installBrowserFakes();
  try {
    await downloader.downloadChatFile({ id: 'file-1', name: 'hello.txt', mimeType: 'text/plain', encoding: 'base64', content: 'aGVsbG8=' });
    assert.equal(anchors[0].download, 'hello.txt');
    assert.equal(anchors[0].href, 'blob:text/plain');
    assert.equal(anchors[0].clicked, true);
  } finally {
    restoreBrowserFakes(original);
  }
});

test('downloads remote artifacts and maps missing files to the existing error', async () => {
  const { original, anchors } = installBrowserFakes();
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['data'], { type: 'application/pdf' }) });
    await downloader.downloadChatFile({ id: 'file-2', name: 'report.pdf', mimeType: 'application/pdf', downloadUrl: '/api/artifacts/file-2' });
    assert.equal(anchors[0].download, 'report.pdf');
    assert.equal(anchors[0].href, 'blob:application/pdf');

    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(
      downloader.downloadChatFile({ id: 'file-3', name: 'expired.docx', mimeType: 'application/docx', downloadUrl: '/api/artifacts/file-3' }),
      /文件已过期或被清理，请重新生成/,
    );
  } finally {
    restoreBrowserFakes(original);
  }
});

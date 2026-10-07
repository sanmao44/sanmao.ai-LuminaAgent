import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const renderer = createTsRequire(process.cwd())('./lib/share-conversation-renderer');

test('conversation share renderer keeps the browser canvas contract', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const loadedUrls = [];
  let canvas;

  class FakeImage {
    naturalWidth = 800;
    naturalHeight = 600;

    set src(value) {
      loadedUrls.push(value);
      this.onload?.();
    }
  }

  const gradient = { addColorStop() {} };
  const context = {
    measureText(value) { return { width: String(value).length * 10 }; },
    createLinearGradient() { return gradient; },
    beginPath() {}, moveTo() {}, arcTo() {}, arc() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, clip() {}, drawImage() {}, fillRect() {}, fillText() {},
  };

  globalThis.Image = FakeImage;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      canvas = {
        width: 0,
        height: 0,
        getContext() { return context; },
        toBlob(callback) { callback(new Blob(['png'], { type: 'image/png' })); },
      };
      return canvas;
    },
  };

  try {
    const result = await renderer.renderShareConversationImage([
      {
        id: 'user-1',
        role: 'user',
        content: 'make a landscape image',
        images: [{ url: 'https://example.test/result.png' }],
        references: [{ id: 'reference-1' }],
        files: [{ name: 'brief.txt' }],
      },
      { id: 'assistant-1', role: 'assistant', content: 'Here is the result.' },
    ]);

    assert.deepEqual(loadedUrls, [
      'https://example.test/result.png',
      '/brand-mark.png',
      '/share-qr.png',
    ]);
    assert.equal(canvas.width > 0, true);
    assert.equal(canvas.height > 0, true);
    assert.equal(result.blob.type, 'image/png');
    assert.equal(result.width, canvas.width);
    assert.equal(result.height, canvas.height);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
});

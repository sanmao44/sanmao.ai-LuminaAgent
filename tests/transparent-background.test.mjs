import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/image-editor/transparent-background.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const transparent = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('white background transparency preserves image metadata and applies the alpha threshold', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  let context;
  let createdCanvas;

  class FakeImage {
    naturalWidth = 2;
    naturalHeight = 1;
    crossOrigin = '';
    set src(value) {
      this.url = value;
      this.onload?.();
    }
  }
  context = {
    drawImage: (...args) => { context.drawArgs = args; },
    getImageData: () => ({ data: Uint8ClampedArray.from([255, 255, 255, 255, 230, 230, 230, 255]) }),
    putImageData: (pixels) => { context.output = pixels.data; },
  };
  globalThis.Image = FakeImage;
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      createdCanvas = {
        width: 0,
        height: 0,
        getContext: (_kind, options) => {
          assert.deepEqual(options, { willReadFrequently: true });
          return context;
        },
        toDataURL: (mime) => {
          assert.equal(mime, 'image/png');
          return 'data:image/png;base64,transparent';
        },
      };
      return createdCanvas;
    },
  };

  try {
    const image = await transparent.makeWhiteBackgroundTransparent({
      id: 'image-1',
      url: 'https://example.test/image.png',
      prompt: 'keep metadata',
    });
    assert.equal(image.id, 'image-1');
    assert.equal(image.prompt, 'keep metadata');
    assert.equal(image.url, 'data:image/png;base64,transparent');
    assert.equal(createdCanvas.width, 2);
    assert.equal(createdCanvas.height, 1);
    assert.deepEqual(context.drawArgs.slice(1), [0, 0]);
    assert.deepEqual([...context.output], [255, 255, 255, 0, 230, 230, 230, 172]);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
});

test('white background transparency reports image loading failures', async () => {
  const originalImage = globalThis.Image;
  class FailingImage {
    set src(_value) {
      this.onerror?.();
    }
  }
  globalThis.Image = FailingImage;
  try {
    await assert.rejects(
      () => transparent.makeWhiteBackgroundTransparent({ url: 'https://example.test/missing.png' }),
      /图片读取失败/u,
    );
  } finally {
    globalThis.Image = originalImage;
  }
});

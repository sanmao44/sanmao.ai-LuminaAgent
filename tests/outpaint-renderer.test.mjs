import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/image-editor/outpaint-renderer.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const renderer = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('outpaint renderer paints a white canvas and centers the source layout', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  let canvas;
  let context;
  class FakeImage {
    set src(value) { this.url = value; this.onload?.(); }
  }
  context = {
    drawImage: (...args) => { context.drawArgs = args; },
    fillRect: (...args) => { context.fillArgs = args; },
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    fillStyle: '',
  };
  globalThis.Image = FakeImage;
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: (mime) => {
          assert.equal(mime, 'image/png');
          return 'data:image/png;base64,outpaint';
        },
      };
      return canvas;
    },
  };
  try {
    const result = await renderer.renderOutpaintWhiteCanvas('https://example.test/source.png', {
      sourceWidth: 800,
      sourceHeight: 600,
      canvasWidth: 1200,
      canvasHeight: 1000,
      offsetX: 200,
      offsetY: 200,
    });
    assert.deepEqual(result, { dataUrl: 'data:image/png;base64,outpaint', width: 1200, height: 1000 });
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 1000);
    assert.equal(context.fillStyle, '#ffffff');
    assert.deepEqual(context.fillArgs, [0, 0, 1200, 1000]);
    assert.deepEqual(context.drawArgs.slice(1), [200, 200, 800, 600]);
    assert.equal(context.imageSmoothingQuality, 'high');
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
});

test('outpaint renderer reports image loading failures', async () => {
  const originalImage = globalThis.Image;
  class FailingImage { set src(_value) { this.onerror?.(); } }
  globalThis.Image = FailingImage;
  try {
    await assert.rejects(
      () => renderer.renderOutpaintWhiteCanvas('https://example.test/missing.png', {
        sourceWidth: 1,
        sourceHeight: 1,
        canvasWidth: 1,
        canvasHeight: 1,
        offsetX: 0,
        offsetY: 0,
      }),
      /无法读取这张图片/u,
    );
  } finally {
    globalThis.Image = originalImage;
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/image-editor/local-image-renderer.ts', import.meta.url);
let source = await readFile(sourceUrl, 'utf8');
source = source.replace("import { canvasRectForRatio, cropSourceRect, LOCAL_IMAGE_ORIGINAL } from './local-image-layout';", `
  const LOCAL_IMAGE_ORIGINAL = '原图';
  const cropSourceRect = (width, height, ratio) => ratio === '1:1' ? { x: 100, y: 0, width: 800, height: 800 } : { x: 0, y: 0, width, height };
  const canvasRectForRatio = (width, height, ratio) => ratio === '1:1' ? { width: Math.max(width, height), height: Math.max(width, height) } : { width, height };
`);
source = source.replace("import type { ImageRect } from '@/lib/canvas/image-operations';", 'type ImageRect = { x: number; y: number; width: number; height: number };');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const renderer = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('local image renderer preserves crop transforms and returns the transformed canvas', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const contexts = [];
  class FakeImage {
    naturalWidth = 1000;
    naturalHeight = 800;
    set src(value) { this.url = value; this.onload?.(); }
  }
  const makeCanvas = () => {
    const context = {
      drawImage: (...args) => { context.drawCalls.push(args); },
      drawCalls: [],
      translate: (...args) => { context.translateArgs = args; },
      rotate: (...args) => { context.rotateArgs = args; },
      scale: (...args) => { context.scaleArgs = args; },
      toDataURL: () => `data:image/png;base64,canvas-${contexts.length}`,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: '',
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: context.toDataURL };
    contexts.push({ canvas, context });
    return canvas;
  };
  globalThis.Image = FakeImage;
  globalThis.document = { createElement: () => makeCanvas() };
  try {
    const result = await renderer.renderLocalImage('https://example.test/image.png', 'crop', '1:1', 'transparent', true, 90, { x: 10, y: 20, width: 300, height: 200 });
    assert.deepEqual(result, { dataUrl: 'data:image/png;base64,canvas-1', width: 200, height: 300 });
    const { context } = contexts[0];
    assert.deepEqual(context.translateArgs, [100, 150]);
    assert.deepEqual(context.scaleArgs, [-1, 1]);
    assert.equal(context.rotateArgs[0], Math.PI / 2);
    assert.deepEqual(context.drawCalls[0].slice(1), [10, 20, 300, 200, -150, -100, 300, 200]);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
});

test('local image renderer adds the selected background when expanding to a canvas ratio', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const contexts = [];
  class FakeImage { naturalWidth = 800; naturalHeight = 400; set src(value) { this.url = value; this.onload?.(); } }
  const makeCanvas = () => {
    const context = {
      drawCalls: [],
      drawImage: (...args) => context.drawCalls.push(args),
      translate() {}, rotate() {}, scale() {}, save() { context.saved = true; }, restore() { context.restored = true; }, fillRect() { context.filled = true; },
      toDataURL: () => `data:image/png;base64,canvas-${contexts.length}`,
      imageSmoothingEnabled: false, imageSmoothingQuality: '', fillStyle: '', filter: '',
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: context.toDataURL };
    contexts.push({ canvas, context });
    return canvas;
  };
  globalThis.Image = FakeImage;
  globalThis.document = { createElement: () => makeCanvas() };
  try {
    const result = await renderer.renderLocalImage('image.png', 'canvas', '1:1', 'white', false, 0);
    assert.deepEqual(result, { dataUrl: 'data:image/png;base64,canvas-2', width: 800, height: 800 });
    assert.equal(contexts[1].context.fillStyle, '#ffffff');
    assert.equal(contexts[1].context.filled, true);
    assert.equal(contexts[1].context.drawCalls.length, 1);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
});

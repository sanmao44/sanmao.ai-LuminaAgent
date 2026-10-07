import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/share-image-layout.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const layout = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const share = createTsRequire(process.cwd())('./lib/canvas/share');

function measure(value, fontSize = 20) {
  return Array.from(value).reduce((total, character) => total + (/[\u0080-\uFFFF]/.test(character) ? fontSize : fontSize * 0.56), 0);
}

test('keeps short prompt in one readable column', () => {
  const plan = layout.buildSharePromptPlan('一张紫色科幻肖像，电影感光线。', measure, 1232);
  assert.equal(plan.columnCount, 1);
  assert.ok(plan.fontSize >= 20);
  assert.equal(plan.overflow, false);
});

test('preserves paragraphs and wraps mixed Chinese and English text', () => {
  const lines = layout.wrapSharePrompt('第一段中文内容\n\nA very long English prompt with several words and a continuous-token-1234567890.', measure, 160, 20);
  assert.ok(lines.includes(''));
  assert.ok(lines.every((line) => !line || measure(line, 20) <= 160 || Array.from(line).length === 1));
  assert.equal(lines.join('').replace(/\s/g, ''), '第一段中文内容AverylongEnglishpromptwithseveralwordsandacontinuous-token-1234567890.'.replace(/\s/g, ''));
});

test('moves long prompts into multiple columns without truncating content', () => {
  const prompt = `${'请保留人物身份、服装材质、紫色光线和完整场景。'.repeat(80)}\n\n${'cinematic composition, detailed texture, controlled perspective. '.repeat(60)}`;
  const plan = layout.buildSharePromptPlan(prompt, measure, 1232);
  assert.ok(plan.columnCount > 1);
  assert.equal(plan.columns.flat().join('').replace(/\s/g, ''), prompt.replace(/\r\n?/g, '\n').trim().replace(/\s/g, ''));
  assert.equal(plan.overflow, false);
});

test('adapts result card to image ratio and accounts for prompt and references', () => {
  const promptPlan = layout.buildSharePromptPlan('短提示词', measure, 1232);
  const portrait = layout.buildShareImageLayout({ resultWidth: 720, resultHeight: 1280, promptPlan, referenceCount: 2 });
  const landscape = layout.buildShareImageLayout({ resultWidth: 1280, resultHeight: 720, promptPlan, referenceCount: 2 });
  assert.ok(portrait.resultFrame.width < portrait.resultFrame.height);
  assert.ok(landscape.resultFrame.width > landscape.resultFrame.height);
  assert.ok(portrait.canvasHeight > portrait.referenceTilesY + portrait.referenceTileHeight);
  assert.equal(portrait.overflow, false);
});

test('reserves a branded footer and keeps the QR area inside the canvas', () => {
  const promptPlan = layout.buildSharePromptPlan('短提示词', measure, 1232);
  const share = layout.buildShareImageLayout({ resultWidth: 1024, resultHeight: 1024, promptPlan, referenceCount: 1 });
  assert.equal(share.resultFrame.y, share.headerHeight);
  assert.ok(share.footerY > share.referenceBottomY);
  assert.ok(share.footerHeight > share.footerQrSize);
  assert.equal(share.canvasHeight, share.footerY + share.footerHeight + share.padding);
  assert.ok(share.footerY + share.footerHeight < share.canvasHeight);
});

test('share exporter loads branded assets, preserves references, and downloads a PNG', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const originalWindow = globalThis.window;
  const loadedUrls = [];
  const appended = [];
  let canvas;
  class FakeImage {
    naturalWidth = 800;
    naturalHeight = 600;
    set src(value) { this.url = value; loadedUrls.push(value); this.onload?.(); }
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
    body: { appendChild(value) { appended.push(value); } },
    createElement(tag) {
      if (tag === 'canvas') {
        canvas = { width: 0, height: 0, getContext() { return context; }, toBlob(callback) { callback(new Blob(['png'], { type: 'image/png' })); } };
        return canvas;
      }
      if (tag === 'a') return { click() { this.clicked = true; }, remove() {}, rel: '' };
      throw new Error('unexpected element: ' + tag);
    },
  };
  globalThis.URL = { createObjectURL() { return 'blob:share'; }, revokeObjectURL() {} };
  globalThis.window = { setTimeout() {} };
  try {
    await share.downloadCanvasShareImage({
      id: 'gallery-1', url: 'https://example.test/generated.png', prompt: 'submitted prompt', modelName: 'model-a', createdAt: 1,
      references: [
        { name: 'source', url: 'https://example.test/source.png', kind: 'image' },
        { name: 'video', url: 'https://example.test/video.mp4', kind: 'video' },
      ],
    });
    assert.deepEqual(loadedUrls, ['https://example.test/generated.png', 'https://example.test/source.png', '/brand-mark.png', '/share-qr.png']);
    assert.equal(canvas.width > 0, true);
    assert.equal(canvas.height > 0, true);
    assert.equal(appended[0].download.includes('gallery-1'), true);
    assert.equal(appended[0].clicked, true);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    globalThis.window = originalWindow;
  }
});

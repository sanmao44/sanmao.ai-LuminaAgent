import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';

const sourceUrl = new URL('../lib/video-input-media.ts', import.meta.url);
const sharpUrl = new URL('../node_modules/sharp/lib/index.js', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8')).replace("from 'sharp'", `from '${sharpUrl}'`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const media = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function dataUrl(bytes, mime = 'image/png') {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function decodeDataUrl(value) {
  return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
}

test('compresses oversized video reference images without changing their aspect ratio', async () => {
  const source = await sharp({
    create: { width: 2730, height: 1535, channels: 3, background: { r: 96, g: 120, b: 180 } },
  }).png().toBuffer();
  const result = await media.compressVideoImageDataUrl(dataUrl(source));
  const output = await decodeDataUrl(result.value);
  const metadata = await sharp(output).metadata();

  assert.equal(result.changed, true);
  assert.ok(result.outputBytes <= media.VIDEO_IMAGE_MAX_BYTES);
  assert.ok(Math.max(metadata.width, metadata.height) <= media.VIDEO_IMAGE_MAX_EDGE);
  assert.ok(Math.abs((metadata.width / metadata.height) - (2730 / 1535)) < 0.002);
});

test('leaves already-safe video images unchanged', async () => {
  const source = await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 20, g: 30, b: 40 } },
  }).png().toBuffer();
  const value = dataUrl(source);
  const result = await media.compressVideoImageDataUrl(value);

  assert.equal(result.changed, false);
  assert.equal(result.value, value);
});

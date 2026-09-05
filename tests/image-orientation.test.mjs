import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../lib/image-orientation.ts', import.meta.url);
const sharpUrl = pathToFileURL(require.resolve('sharp')).href;
const source = (await readFile(sourceUrl, 'utf8')).replace("from 'sharp'", `from '${sharpUrl}'`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const orientation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const starApi = { name: 'star api-OpenAI', baseUrl: 'https://www.starapi.cc' };
const otherProvider = { name: 'OpenAI compatible', baseUrl: 'https://images.example.test' };
const landscape = { aspectRatio: '16:9', width: 4096, height: 2304 };

test('removes contradictory vertical framing and adds a targeted landscape constraint', () => {
  const prompt = orientation.normalizeStarApiLandscapePrompt(starApi, 'gpt-image-2', '女性，垂直构图，portrait composition', landscape);
  assert.match(prompt, /横向构图/);
  assert.doesNotMatch(prompt, /垂直构图|portrait composition/);
  assert.match(prompt, /Landscape-oriented wide composition/);
});

test('uses the selected wide ratio in the prompt instead of forcing 16:9', () => {
  const prompt = orientation.normalizeStarApiLandscapePrompt(starApi, 'gpt-image-2', '城市夜景', { aspectRatio: '21:9' });
  assert.match(prompt, /21:9 horizontal framing/);
  assert.doesNotMatch(prompt, /16:9 horizontal framing/);
});

test('leaves prompts for other providers and non-landscape requests unchanged', () => {
  const prompt = '垂直构图 portrait composition';
  assert.equal(orientation.normalizeStarApiLandscapePrompt(otherProvider, 'gpt-image-2', prompt, landscape), prompt);
  assert.equal(orientation.normalizeStarApiLandscapePrompt(starApi, 'gpt-image-2', prompt, { aspectRatio: '9:16', width: 2304, height: 4096 }), prompt);
});

test('converts an upstream portrait result to an exact 16:9 canvas without stretching', async () => {
  const portrait = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 28, g: 8, b: 56 } } }).png().toBuffer();
  const images = await orientation.normalizeStarApiLandscapeImages(starApi, 'gpt-image-2', landscape, [{ url: `data:image/png;base64,${portrait.toString('base64')}` }]);
  const output = Buffer.from(images[0].url.slice(images[0].url.indexOf(',') + 1), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1536);
  assert.equal(metadata.height, 864);
});

test('converts a default portrait result to a square 1:1 canvas', async () => {
  const portrait = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 28, g: 8, b: 56 } } }).png().toBuffer();
  const images = await orientation.normalizeStarApiLandscapeImages(starApi, 'gpt-image-2', { aspectRatio: '1:1' }, [{ url: `data:image/png;base64,${portrait.toString('base64')}` }]);
  const output = Buffer.from(images[0].url.slice(images[0].url.indexOf(',') + 1), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
});

test('converts a default 16:9 result to the requested 21:9 canvas', async () => {
  const wide = await sharp({ create: { width: 1672, height: 941, channels: 3, background: { r: 28, g: 8, b: 56 } } }).png().toBuffer();
  const images = await orientation.normalizeStarApiLandscapeImages(starApi, 'gpt-image-2', { aspectRatio: '21:9' }, [{ url: `data:image/png;base64,${wide.toString('base64')}` }]);
  const output = Buffer.from(images[0].url.slice(images[0].url.indexOf(',') + 1), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1680);
  assert.equal(metadata.height, 720);
});

test('converts a default landscape result to the requested 9:16 canvas', async () => {
  const landscapeInput = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 28, g: 8, b: 56 } } }).png().toBuffer();
  const images = await orientation.normalizeStarApiLandscapeImages(starApi, 'gpt-image-2', { aspectRatio: '9:16' }, [{ url: `data:image/png;base64,${landscapeInput.toString('base64')}` }]);
  const output = Buffer.from(images[0].url.slice(images[0].url.indexOf(',') + 1), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 864);
  assert.equal(metadata.height, 1536);
});

test('honors an explicit custom output size when its ratio matches', async () => {
  const portrait = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 28, g: 8, b: 56 } } }).png().toBuffer();
  const images = await orientation.normalizeStarApiLandscapeImages(starApi, 'gpt-image-2', { aspectRatio: '16:9', sizeMode: 'custom', width: 1920, height: 1080 }, [{ url: `data:image/png;base64,${portrait.toString('base64')}` }]);
  const output = Buffer.from(images[0].url.slice(images[0].url.indexOf(',') + 1), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
});

test('does not change other providers', async () => {
  const portrait = await sharp({ create: { width: 8, height: 12, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();
  const url = `data:image/png;base64,${portrait.toString('base64')}`;
  const images = await orientation.normalizeStarApiLandscapeImages(otherProvider, 'gpt-image-2', landscape, [{ url }]);
  assert.equal(images[0].url, url);
});

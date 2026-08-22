import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-image.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const standaloneSource = source.replace(/^import .+;\r?\n/gm, '');
const compiled = ts.transpileModule(standaloneSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const image = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('exposes the documented Jimeng image models for the image panel', () => {
  assert.deepEqual(image.jimengImageModels.map((model) => model.id), [
    'jimeng-cli-image', 'seedream5.0pro', 'seedream4.7',
  ]);
  assert.equal(image.jimengImageModels.find((model) => model.id === 'seedream5.0pro').name, 'Seedream 5.0 Pro');
  assert.equal(image.jimengImageModels.every((model) => model.capabilities.includes('generate')), true);
});

test('maps the selected Jimeng image model to the official CLI version', () => {
  assert.equal(image.jimengImageModelVersion('seedream-5.0-pro'), 'seedream5.0pro');
  assert.equal(image.jimengImageModelVersion('seedream5.0'), 'seedream5.0');
  assert.equal(image.jimengImageModelVersion('seedream4.7'), 'seedream4.7');
  assert.equal(image.jimengImageModelVersion('jimeng-cli-image'), undefined);
});

test('passes the selected image model version to text2image and image2image', () => {
  assert.deepEqual(image.buildJimengImageCliArgs('text2image', { prompt: 'a red fox', aspectRatio: '16:9', resolution: '2K', count: 2 }, [], 'seedream5.0pro'), [
    'text2image', '--model_version', 'seedream5.0pro', '--prompt', 'a red fox', '--resolution_type', '2k', '--generate_num', '2', '--ratio', '16:9',
  ]);
  assert.deepEqual(image.buildJimengImageCliArgs('image2image', { prompt: 'make it cinematic', resolution: '4K' }, ['reference.png'], 'seedream4.7'), [
    'image2image', '--model_version', 'seedream4.7', '--prompt', 'make it cinematic', '--resolution_type', '4k', '--generate_num', '1', '--images', 'reference.png',
  ]);
});

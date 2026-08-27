import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-image.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const cliSource = await readFile(new URL('../lib/jimeng-cli.ts', import.meta.url), 'utf8');
const standaloneSource = `${cliSource}\n${source}`.replace(/^import .+;\r?\n/gm, '');
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
  assert.equal(image.jimengImageModelVersion('seedream-5.0-pro'), '5.0Pro');
  assert.equal(image.jimengImageModelVersion('seedream5.0'), '5.0');
  assert.equal(image.jimengImageModelVersion('seedream4.7'), '4.7');
  assert.equal(image.jimengImageModelVersion('jimeng-cli-image'), undefined);
});

test('passes the selected image model version to text2image and image2image', () => {
  assert.deepEqual(image.buildJimengImageCliArgs('text2image', { prompt: 'a red fox', aspectRatio: '16:9', resolution: '2K', count: 2 }, [], 'seedream5.0pro'), [
    'text2image', '--model_version', '5.0Pro', '--prompt', 'a red fox', '--resolution_type', '2k', '--generate_num', '2', '--ratio', '16:9',
  ]);
  assert.deepEqual(image.buildJimengImageCliArgs('image2image', { prompt: 'make it cinematic', resolution: '4K' }, ['reference.png'], 'seedream4.7'), [
    'image2image', '--model_version', '4.7', '--prompt', 'make it cinematic', '--resolution_type', '4k', '--generate_num', '1', '--images', 'reference.png',
  ]);
});

test('parses formatted async responses and nested image results', () => {
  const parsed = image.imagesFrom(`\n${JSON.stringify({
    submit_id: 'task-123',
    gen_status: 'success',
    result_json: { images: [{ image_url: 'https://cdn.example.test/result.png' }] },
  }, null, 2)}\n`);
  assert.equal(parsed.taskId, 'task-123');
  assert.equal(parsed.done, true);
  assert.deepEqual(parsed.images, [{ url: 'https://cdn.example.test/result.png' }]);
});

test('recognizes the CLI numeric success status', () => {
  const parsed = image.imagesFrom(JSON.stringify({ submit_id: 'task-456', result_json: { task: { status: 50 } } }));
  assert.equal(parsed.taskId, 'task-456');
  assert.equal(parsed.done, true);
});

test('exposes and maps the installed Jimeng image upscale command', () => {
  assert.equal(image.jimengImageModels.find((model) => model.id === 'jimeng-cli-image').capabilities.includes('upscale'), true);
  assert.deepEqual(image.buildJimengImageUpscaleCliArgs('input.png', '2048x1536'), [
    'image_upscale', '--image', 'input.png', '--resolution_type', '2k', '--poll', '30',
  ]);
  assert.deepEqual(image.buildJimengImageUpscaleCliArgs('input.png', '3840x2160'), [
    'image_upscale', '--image', 'input.png', '--resolution_type', '4k', '--poll', '30',
  ]);
});

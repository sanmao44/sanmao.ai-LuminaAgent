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

test('builds the official Canvas CLI text-to-image node command', () => {
  assert.deepEqual(image.buildJimengCanvasImageArgs('project-1', {
    prompt: 'a red fox', aspectRatio: '16:9', resolution: '2K', count: 2,
  }, 'seedream_4.7', [], 'submit-1'), [
    'node', 'create', 'image', '--project-id', 'project-1', '--run', '--mode', 't2i', '--title', 'a red fox', '--prompt', 'a red fox', '--count', '2',
    '--model', 'seedream_4.7', '--ratio', '16:9', '--resolution', '2K', '--submit-id', 'submit-1',
  ]);
});

test('builds the official Canvas CLI image-to-image command with typed refs', () => {
  assert.deepEqual(image.buildJimengCanvasImageArgs('project-2', {
    prompt: 'keep the composition', aspectRatio: '1:1', resolution: '1K', count: 1,
  }, 'seedream_5.0_pro', ['resource-1', 'resource-2'], 'submit-2'), [
    'node', 'create', 'image', '--project-id', 'project-2', '--run', '--mode', 'i2i', '--title', 'keep the composition', '--prompt', 'keep the composition', '--count', '1',
    '--model', 'seedream_5.0_pro', '--ratio', '1:1', '--resolution', '1K', '--submit-id', 'submit-2', '--ref', 'res:resource-1', '--ref', 'res:resource-2',
  ]);
});

test('preserves the requested image count for official dynamic model validation', () => {
  const args = image.buildJimengCanvasImageArgs('project-3', {
    prompt: 'batch', count: 12,
  }, 'seedream_4.7', [], 'submit-3');
  assert.equal(args[args.indexOf('--count') + 1], '12');
});

test('waits for official operation resources before downloading images', () => {
  assert.deepEqual(image.canvasImageResourceIds({ values: [{ state: 'running', resources: [
    { resourceId: 'image-running', state: 'running' },
  ] }], latest: {}, output: '' }), []);
  assert.deepEqual(image.canvasImageResourceIds({ values: [{ state: 'success', resources: [
    { resourceId: 'image-ready', state: 'success', format: 'png' },
    { resourceId: 'video-ready', state: 'success', format: 'mp4' },
  ] }], latest: {}, output: '' }), ['image-ready']);
});

test('uses the operation submission instead of a resource submit id', () => {
  assert.equal(image.canvasSubmitId({ values: [{
    node: { resources: [{ resourceId: 'image-1', submitId: 'resource-submit' }] },
    submission: { identity: { value: 'operation-submit' } },
  }], latest: {}, output: '' }), 'operation-submit');
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

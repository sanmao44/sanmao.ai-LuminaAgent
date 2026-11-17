import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-canvas-video.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const cliSourceUrl = new URL('../lib/jimeng-cli.ts', import.meta.url);
const cliSource = await readFile(cliSourceUrl, 'utf8');
const bundled = source
  .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
  .replace("import { discoverJimengCanvasModels, resolveJimengCanvasCliCommand, runJimengCanvasCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const resolveJimengCanvasCliCommand = (value) => value || 'dreamina-canvas'; const runJimengCanvasCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
const compiled = ts.transpileModule(bundled, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const canvas = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const cliCompiled = ts.transpileModule(cliSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: cliSourceUrl.pathname,
}).outputText;
const cli = await import(`data:text/javascript;base64,${Buffer.from(cliCompiled).toString('base64')}`);

test('builds the official Canvas CLI text-to-video node command', () => {
  assert.deepEqual(canvas.buildJimengCanvasVideoArgs('project-1', {
    prompt: '海边日落', seconds: 8, aspectRatio: '16:9', resolution: '720p',
  }, 'seedance_2.0_fast_vip', []), [
    'node', 'create', 'video', '--project-id', 'project-1', '--run', '--title', '海边日落', '--mode', 't2v', '--prompt', '海边日落',
    '--model', 'seedance_2.0_fast_vip', '--ratio', '16:9', '--resolution', '720p', '--duration', '8', '--count', '1',
  ]);
});
test('maps Canvas reference inputs to m2v and typed resource references', () => {
  assert.deepEqual(canvas.buildJimengCanvasVideoArgs('project-2', {
    prompt: '保持主体稳定', seconds: 5, aspectRatio: '9:16', resolution: '720p', referenceImages: ['img-1', 'img-2'],
  }, 'seedance_2.5', ['resource-1', 'resource-2']), [
    'node', 'create', 'video', '--project-id', 'project-2', '--run', '--title', '保持主体稳定', '--mode', 'm2v', '--prompt', '保持主体稳定',
    '--model', 'seedance_2.5', '--ratio', '9:16', '--resolution', '720p', '--duration', '5', '--count', '1',
    '--ref', 'res:resource-1', '--ref', 'res:resource-2',
  ]);
});

test('uses first_last_frame for ordered frame references and recognizes the new executable', () => {
  assert.equal(canvas.isJimengCanvasCommand('C:/Users/demo/bin/dreamina-canvas.exe'), true);
  assert.equal(canvas.isJimengCanvasCommand('dreamina.exe'), false);
  assert.deepEqual(canvas.buildJimengCanvasVideoArgs('project-3', {
    prompt: '从白天过渡到夜晚', seconds: 6, firstFrame: 'first', lastFrame: 'last',
  }, 'seedance_2.0', ['first-resource', 'last-resource']), [
    'node', 'create', 'video', '--project-id', 'project-3', '--run', '--title', '从白天过渡到夜晚', '--mode', 'first_last_frame', '--prompt', '从白天过渡到夜晚',
    '--model', 'seedance_2.0', '--duration', '6', '--count', '1', '--ref', 'res:first-resource', '--ref', 'res:last-resource',
  ]);
});

test('does not synthesize unsupported submission or confirmation flags', () => {
  const args = canvas.buildJimengCanvasVideoArgs('project-4', { prompt: 'test' }, 'seedance_2.5', []);
  assert.equal(args.includes('--submit-id'), false);
  assert.equal(args.includes('--yes'), false);
});

test('normalizes the official Canvas model list without inventing model ids', () => {
  const models = cli.parseJimengCanvasModelList(JSON.stringify({ data: { items: [
    { type: 'video', model: 'seedance_2.0_fast_vip', displayName: 'Seedance 2.0 Fast VIP', aliases: ['seedance2.0fast_vip'], modes: [
      { name: 't2v', flags: { duration: { values: [5, 8] } } },
      { name: 'm2v', flags: { duration: { values: [5, 8] } } },
    ] },
    { type: 'image', model: 'seedream_4.7', displayName: 'Seedream 4.7' },
  ] } }), 'video');
  assert.equal(models.length, 1);
  assert.equal(models[0].model, 'seedance_2.0_fast_vip');
  assert.equal(models[0].name, 'Seedance 2.0 Fast VIP');
  assert.deepEqual(models[0].aliases, ['seedance2.0fast_vip']);
  assert.deepEqual(models[0].modes.map((mode) => mode.name), ['t2v', 'm2v']);
  assert.deepEqual(models[0].schema.modes[0].flags.duration.values, [5, 8]);
});

test('waits for official operation resources before downloading videos', () => {
  assert.deepEqual(canvas.videoResourceIds({ values: [{ state: 'running', resources: [
    { resourceId: 'video-running', state: 'running' },
  ] }], latest: {}, output: '' }), []);
  assert.deepEqual(canvas.videoResourceIds({ values: [{ state: 'success', resources: [
    { resourceId: 'video-ready', state: 'success', format: 'mp4' },
    { resourceId: 'video-failed', state: 'failed', format: 'mp4' },
  ] }], latest: {}, output: '' }), ['video-ready']);
});

test('keeps the official nested submission identity for async polling', async () => {
  const sourceWithExport = `${source}\nexport { submissionId };`;
  const bundledWithExport = sourceWithExport
    .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
    .replace("import { discoverJimengCanvasModels, resolveJimengCanvasCliCommand, runJimengCanvasCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const resolveJimengCanvasCliCommand = (value) => value || 'dreamina-canvas'; const runJimengCanvasCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
  const compiledWithExport = ts.transpileModule(bundledWithExport, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const exportedCanvas = await import(`data:text/javascript;base64,${Buffer.from(compiledWithExport).toString('base64')}`);
  assert.equal(exportedCanvas.submissionId({ values: [{ data: { submission: { identity: { value: 'official-submit-id' } } } }], latest: {}, output: '' }), 'official-submit-id');
});

test('prioritizes the operation submission over resource submit ids', async () => {
  const sourceWithExport = `${source}\nexport { submissionId };`;
  const bundledWithExport = sourceWithExport
    .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
    .replace("import { discoverJimengCanvasModels, resolveJimengCanvasCliCommand, runJimengCanvasCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const resolveJimengCanvasCliCommand = (value) => value || 'dreamina-canvas'; const runJimengCanvasCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
  const compiledWithExport = ts.transpileModule(bundledWithExport, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const exportedCanvas = await import(`data:text/javascript;base64,${Buffer.from(compiledWithExport).toString('base64')}`);
  assert.equal(exportedCanvas.submissionId({ values: [{ node: { resources: [{ resourceId: 'video-1', submitId: 'resource-submit-id' }] }, submission: { submitId: 'operation-submit-id' } }], latest: {}, output: '' }), 'operation-submit-id');
});

test('does not treat a resource submit id as a resumable operation', async () => {
  const sourceWithExport = `${source}\nexport { submissionId };`;
  const bundledWithExport = sourceWithExport
    .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
    .replace("import { discoverJimengCanvasModels, resolveJimengCanvasCliCommand, runJimengCanvasCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const resolveJimengCanvasCliCommand = (value) => value || 'dreamina-canvas'; const runJimengCanvasCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
  const compiledWithExport = ts.transpileModule(bundledWithExport, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const exportedCanvas = await import(`data:text/javascript;base64,${Buffer.from(compiledWithExport).toString('base64')}`);
  assert.equal(exportedCanvas.submissionId({ values: [{ resources: [{ resourceId: 'video-1', submitId: 'resource-submit-id' }] }], latest: {}, output: '' }), '');
});

test('accepts operation wait resources without a media type field', async () => {
  const sourceWithExport = `${source}\nexport { videoResourceIds };`;
  const bundledWithExport = sourceWithExport
    .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
    .replace("import { discoverJimengCanvasModels, resolveJimengCanvasCliCommand, runJimengCanvasCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const resolveJimengCanvasCliCommand = (value) => value || 'dreamina-canvas'; const runJimengCanvasCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
  const compiledWithExport = ts.transpileModule(bundledWithExport, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const exportedCanvas = await import(`data:text/javascript;base64,${Buffer.from(compiledWithExport).toString('base64')}`);
  assert.deepEqual(exportedCanvas.videoResourceIds({ values: [{ resources: [{ resourceId: 'video-resource-1', state: 'succeeded', width: 1920, height: 1080, format: 'mp4' }] }], latest: {}, output: '' }), ['video-resource-1']);
});


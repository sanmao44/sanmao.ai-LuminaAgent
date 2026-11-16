import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-canvas-video.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const bundled = source
  .replace("import { VideoProviderError } from './video-providers';", "class VideoProviderError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }")
  .replace("import { discoverJimengCanvasModels, runJimengCli } from './jimeng-cli';", "const discoverJimengCanvasModels = async () => []; const runJimengCli = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });");
const compiled = ts.transpileModule(bundled, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const canvas = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('builds the official Canvas CLI text-to-video node command', () => {
  assert.deepEqual(canvas.buildJimengCanvasVideoArgs('project-1', {
    prompt: '海边日落', seconds: 8, aspectRatio: '16:9', resolution: '720p',
  }, 'seedance_2.0_fast_vip', []), [
    'node', 'create', 'video', '--project-id', 'project-1', '--run', '--wait', '--yes', '--mode', 't2v', '--prompt', '海边日落',
    '--model', 'seedance_2.0_fast_vip', '--ratio', '16:9', '--resolution', '720p', '--duration', '8', '--count', '1',
  ]);
});

test('maps Canvas reference inputs to m2v and typed resource references', () => {
  assert.deepEqual(canvas.buildJimengCanvasVideoArgs('project-2', {
    prompt: '保持主体稳定', seconds: 5, aspectRatio: '9:16', resolution: '720p', referenceImages: ['img-1', 'img-2'],
  }, 'seedance_2.5', ['resource-1', 'resource-2']), [
    'node', 'create', 'video', '--project-id', 'project-2', '--run', '--wait', '--yes', '--mode', 'm2v', '--prompt', '保持主体稳定',
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
    'node', 'create', 'video', '--project-id', 'project-3', '--run', '--wait', '--yes', '--mode', 'first_last_frame', '--prompt', '从白天过渡到夜晚',
    '--model', 'seedance_2.0', '--duration', '6', '--count', '1', '--ref', 'res:first-resource', '--ref', 'res:last-resource',
  ]);
});


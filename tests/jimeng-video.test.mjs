import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-video.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const video = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('exposes documented Jimeng video model versions with shared capabilities', () => {
  assert.deepEqual(video.jimengVideoModels.map((model) => model.id), [
    'jimeng-cli-video', 'seedance2.0', 'seedance2.0fast', 'seedance2.0mini', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.5',
  ]);
  assert.deepEqual(video.jimengVideoModels.find((model) => model.id === 'seedance2.5').capabilities, [
    'video-generate', 'video-edit', 'video-extend', 'video-first-frame', 'video-reference', 'video-audio',
  ]);
});

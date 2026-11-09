import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/creation/history-layout.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const layout = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('automatic history pages end on complete grid rows', () => {
  assert.equal(layout.completeHistoryPageSize(7, 12), 14);
  assert.equal(layout.completeHistoryPageSize(6, 12), 12);
  assert.equal(layout.completeHistoryPageSize(4, 12), 12);
});

test('automatic image and video pages use their own responsive column counts', () => {
  assert.deepEqual(layout.completeHistoryGridPageSizes({ images: 7, videos: 6 }, 12), {
    images: 14,
    videos: 12,
  });
  assert.deepEqual(layout.completeHistoryGridPageSizes({ videos: 2 }, 12), { videos: 12 });
});

test('automatic history page sizing handles invalid column counts', () => {
  assert.equal(layout.completeHistoryPageSize(0, 12), 12);
  assert.equal(layout.completeHistoryPageSize(Number.NaN, 12), 12);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/reference-images.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('keeps reference order and bounded metadata', () => {
  const result = references.normalizeReferenceRecords([
    { id: 'one', name: '原图.png', url: 'data:image/png;base64,AAA' },
    { id: 'two', name: '3D导引.webp', url: '/api/storage/file?name=guide.webp' },
    { id: 'ignored', name: '', url: '' },
  ], { keepDataUrls: true });
  assert.deepEqual(result.map((item) => item.name), ['原图.png', '3D导引.webp']);
  assert.equal(result[0].id, 'one');
  assert.equal(result[1].url, '/api/storage/file?name=guide.webp');
});

test('removes data URLs from log references without losing names', () => {
  const result = references.referenceRecordsForLog([
    { id: 'one', name: '上传原图.png', url: 'data:image/png;base64,very-large-data' },
    { id: 'two', name: '导引图.webp', url: '/api/storage/file?name=guide.webp' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, '上传原图.png');
  assert.equal(result[0].url, '');
  assert.equal(result[1].url, '/api/storage/file?name=guide.webp');
});

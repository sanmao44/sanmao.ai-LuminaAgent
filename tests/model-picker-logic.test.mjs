import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-picker.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const model = (id, providerName = '接口 A') => ({
  id,
  providerId: providerName,
  providerName,
  rawId: `raw-${id}`,
  displayName: id,
});

test('model search matches display name, raw id and provider name', () => {
  assert.equal(picker.modelPickerMatches(model('image-2', '图片接口'), 'image-2'), true);
  assert.equal(picker.modelPickerMatches(model('image-2', '图片接口'), '图片接口'), true);
  assert.equal(picker.modelPickerMatches(model('image-2'), '不存在'), false);
});

test('quick model slices remove duplicates across sections and respect their limit', () => {
  const seen = new Set();
  const models = [model('a'), model('b'), model('a'), model('c'), model('d')];
  assert.deepEqual(picker.takeUniqueModelSlice(models, seen, 3).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(picker.takeUniqueModelSlice([model('b'), model('d')], seen, 4).map((item) => item.id), ['d']);
});

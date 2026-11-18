import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../components/model-library-provider-picker-logic.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const providers = [
  { id: 'modelscope', name: '魔搭社区', availableModelCount: 8 },
  { id: 'moark', name: '模力方舟', availableModelCount: 3 },
  { id: 'openai', name: 'OpenAI', availableModelCount: 2 },
];

test('provider search matches names and IDs without case sensitivity', () => {
  assert.deepEqual(picker.filterModelLibraryProviders(providers, ' 方舟 '), [providers[1]]);
  assert.deepEqual(picker.filterModelLibraryProviders(providers, 'OPENAI'), [providers[2]]);
  assert.equal(picker.filterModelLibraryProviders(providers, 'open').at(0)?.id, 'openai');
  assert.deepEqual(picker.filterModelLibraryProviders(providers, 'missing'), []);
  assert.deepEqual(picker.filterModelLibraryProviders(providers, '  '), providers);
});

test('provider keyboard navigation wraps and keeps the current value when empty', () => {
  const values = ['', 'modelscope', 'moark'];
  assert.equal(picker.nextModelLibraryProviderValue(values, '', -1), 'moark');
  assert.equal(picker.nextModelLibraryProviderValue(values, 'moark', 1), '');
  assert.equal(picker.nextModelLibraryProviderValue([], 'moark', 1), 'moark');
});

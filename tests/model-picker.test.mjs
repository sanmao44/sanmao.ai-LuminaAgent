import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../components/ModelPicker.tsx', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .+;\r?\n/gm, ''), {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('model picker accepts an empty automatic recommendation', () => {
  const model = { id: 'chat-1' };
  assert.deepEqual(picker.uniqueModels([undefined, null, model, model]), [model]);
  assert.deepEqual(picker.uniqueModels([undefined]), []);
});

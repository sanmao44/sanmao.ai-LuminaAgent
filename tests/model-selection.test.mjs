import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-selection.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const selection = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const models = [
  { id: 'full', providerId: 'images' },
  { id: 'lite', providerId: 'images' },
  { id: 'fallback', providerId: 'other' },
];

test('auto selection keeps the configured model inside the default provider', () => {
  assert.equal(selection.selectAutomaticModel(models, 'images', 'lite')?.id, 'lite');
});

test('auto selection honors the default provider before a model from another provider', () => {
  assert.equal(selection.selectAutomaticModel(models, 'images', 'fallback')?.id, 'full');
});

test('auto selection falls back to the configured model without a default provider', () => {
  assert.equal(selection.selectAutomaticModel(models, null, 'fallback')?.id, 'fallback');
});

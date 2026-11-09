import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/intent-classifier.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const classifier = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('new JEV catalog entries default to enabled while other model defaults remain unchanged', () => {
  assert.equal(classifier.isIntentClassifierEnabledByDefault('jev-1.14'), true);
  assert.equal(classifier.isIntentClassifierEnabledByDefault('provider/jev-1.14'), true);
  assert.equal(classifier.isIntentClassifierEnabledByDefault('jev-1.13'), false);
  assert.equal(classifier.isIntentClassifierEnabledByDefault('gpt-5'), false);
  assert.equal(classifier.isIntentClassifierEnabledByDefault('gpt-5', true), true);
});

test('legacy JEV router models stay internal while only the current model can classify intent', () => {
  assert.equal(classifier.isInternalIntentModel({ rawId: 'jev-1.13' }), true);
  assert.equal(classifier.isInternalIntentModel({ rawId: 'provider/jev-1.13' }), true);
  assert.equal(classifier.isIntentClassifierModel({ rawId: 'jev-1.13' }), false);
  assert.equal(classifier.isInternalIntentModel({ rawId: 'jev-1.14' }), true);
  assert.equal(classifier.isIntentClassifierModel({ rawId: 'jev-1.14' }), true);
  assert.equal(classifier.isInternalIntentModel({ rawId: 'gpt-5' }), false);
});

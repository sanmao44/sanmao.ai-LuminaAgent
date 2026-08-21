import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/provider-availability.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const availability = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const providers = [
  { id: 'legacy', modelLibraryEnabled: undefined },
  { id: 'enabled', modelLibraryEnabled: true },
  { id: 'hidden', modelLibraryEnabled: false },
];
const models = [
  { id: 'legacy-model', providerId: 'legacy', enabled: true, published: true },
  { id: 'enabled-model', providerId: 'enabled', enabled: true, published: true },
  { id: 'hidden-model', providerId: 'hidden', enabled: true, published: true },
];

test('legacy and explicitly enabled providers join the model library', () => {
  assert.equal(availability.isProviderModelLibraryEnabled(providers[0]), true);
  assert.equal(availability.isProviderModelLibraryEnabled(providers[1]), true);
  assert.equal(availability.isProviderModelLibraryEnabled(providers[2]), false);
});

test('hidden providers are excluded without mutating model selection state', () => {
  const visible = availability.filterModelsByActiveProviders(models, providers);
  assert.deepEqual(visible.map((model) => model.id), ['legacy-model', 'enabled-model']);
  assert.equal(models[2].enabled, true);
  assert.equal(models[2].published, true);
});

test('reenabling a provider restores its existing model records and checked state', () => {
  const hiddenProvider = { id: 'hidden', modelLibraryEnabled: true };
  const visible = availability.filterModelsByActiveProviders(models, [...providers.slice(0, 2), hiddenProvider]);
  assert.deepEqual(visible.map((model) => model.id), ['legacy-model', 'enabled-model', 'hidden-model']);
  assert.equal(visible[2].enabled, true);
  assert.equal(visible[2].published, true);
});

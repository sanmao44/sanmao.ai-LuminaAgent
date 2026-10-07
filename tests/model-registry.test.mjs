import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-registry.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const registry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function model(overrides = {}) {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    providerName: 'APIKL',
    rawId: 'gpt-image-2-pro',
    displayName: 'gpt-image-2-pro',
    kind: 'image',
    enabled: false,
    published: false,
    capabilities: ['generate'],
    ...overrides,
  };
}

test('builds a disabled manual image model with generation capability', () => {
  const created = registry.buildManualModelRecord({
    id: 'manual-1',
    providerId: 'provider-1',
    providerName: 'APIKL',
    rawId: 'gpt-image-2-pro',
    displayName: 'GPT Image 2 Pro',
    kind: 'image',
    inferred: { kind: 'image', capabilities: [] },
  });
  assert.equal(created.source, 'manual');
  assert.equal(created.kind, 'image');
  assert.equal(created.enabled, false);
  assert.equal(created.published, false);
  assert.ok(created.capabilities.includes('generate'));
});

test('preserves manual models and enabled state when upstream returns the same ID', () => {
  const existing = model({ id: 'manual-1', source: 'manual', enabled: true, published: true });
  const discovered = model({ id: 'discovered-1', source: 'discovered', enabled: false, published: false, displayName: 'Upstream name' });
  const merged = registry.mergeProviderModelRecords([existing], [discovered]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'manual-1');
  assert.equal(merged[0].source, 'manual');
  assert.equal(merged[0].enabled, true);
  assert.equal(merged[0].published, true);
  assert.equal(merged[0].displayName, 'Upstream name');
});

test('keeps a manual model missing from the latest upstream list and removes duplicate IDs', () => {
  const manual = model({ id: 'manual-1', rawId: 'gpt-image-2-4K', source: 'manual' });
  const discovered = [
    model({ id: 'discovered-1', rawId: 'gpt-image-2', source: 'discovered' }),
    model({ id: 'discovered-2', rawId: 'gpt-image-2', source: 'discovered' }),
  ];
  const merged = registry.mergeProviderModelRecords([manual], discovered);
  assert.deepEqual(merged.map((item) => item.rawId), ['gpt-image-2', 'gpt-image-2-4K']);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/providers.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const providers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('normalizes common model list response shapes', () => {
  assert.deepEqual(providers.normalizeDiscoveredModels({ data: [{ id: 'a' }, { id: 'b', name: '模型 B' }] }), [
    { id: 'a', name: 'a', capabilities: [] },
    { id: 'b', name: '模型 B', capabilities: [] },
  ]);
  assert.deepEqual(providers.normalizeDiscoveredModels({ models: ['c', 'd'] }), [
    { id: 'c', name: 'c' },
    { id: 'd', name: 'd' },
  ]);
  assert.deepEqual(providers.normalizeDiscoveredModels({ data: { models: [{ model: 'e' }] } }), [
    { id: 'e', name: 'e', capabilities: [] },
  ]);
});

test('adds the standard v1 model endpoint for a provider website root', () => {
  const candidates = providers.modelEndpointCandidates({
    type: 'openai-compatible',
    baseUrl: 'https://api.apiqik.com',
    modelsPath: '/models',
    apiKey: 'test',
  });
  assert.deepEqual(candidates, [
    { url: 'https://api.apiqik.com/models' },
    { url: 'https://api.apiqik.com/v1/models', inferredBaseUrl: 'https://api.apiqik.com/v1' },
  ]);
});

test('does not override an explicitly versioned base URL', () => {
  const candidates = providers.modelEndpointCandidates({
    type: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    modelsPath: '/models',
    apiKey: 'test',
  });
  assert.deepEqual(candidates, [{ url: 'https://example.com/v1/models' }]);
});

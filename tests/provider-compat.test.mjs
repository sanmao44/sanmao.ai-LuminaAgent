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

test('normalizes image responses from common provider protocols', () => {
  const b64 = 'iVBORw0KGgoAAAAAAAAAAAAA';
  assert.deepEqual(providers.normalizeProviderImages({ data: [{ b64_json: b64, revised_prompt: 'updated' }] }), [
    { url: `data:image/png;base64,${b64}`, revisedPrompt: 'updated' },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ output: [{ type: 'image_generation_call', result: b64 }] }), [
    { url: `data:image/png;base64,${b64}` },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] } }] }), [
    { url: `data:image/jpeg;base64,${b64}` },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'https://cdn.example.test/result.png' } }] } }] }), [
    { url: 'https://cdn.example.test/result.png' },
  ]);
  assert.deepEqual(providers.normalizeProviderImages({ content: '![result](https://cdn.example.test/result.png)' }), [
    { url: 'https://cdn.example.test/result.png' },
  ]);
});

test('does not mistake an asynchronous task id for an image', () => {
  assert.throws(
    () => providers.normalizeProviderImages({ id: 'task_0123456789abcdef0123456789abcdef', status: 'processing' }),
    /没有找到可显示的图片/,
  );
  assert.throws(
    () => providers.normalizeProviderImages({ data: { task_id: '0123456789abcdef0123456789abcdef', state: 'processing' } }),
    /没有找到可显示的图片/,
  );
});

test('does not retry image requests after ambiguous upstream failures', () => {
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'transport', providerStatus: 0 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'timeout', providerStatus: 0 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 500 }), false);
  assert.equal(providers.canRetryImageRequest({ providerFailureKind: 'http', providerStatus: 422 }), true);
});

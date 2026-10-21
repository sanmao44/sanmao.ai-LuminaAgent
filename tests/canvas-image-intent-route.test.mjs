import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../app/api/generate/intent/route.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');

function loadRoute(options = {}) {
  const calls = [];
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === '@/apps/api/image-intent-composition') {
      return {
        resolveCanvasImageRequestIntent: async input => {
          calls.push(input);
          return options.resolution || { operation: 'reference-generate', classifierStatus: 'used', classifierModelId: 'jev-runtime', classifierMs: 18 };
        },
      };
    }
    if (name === '@/lib/auth') return { isTrustedAppRequest: request => request.headers.get('x-trusted') === '1' };
    if (name === '@/packages/contracts/creative') return { MAX_IMAGE_REFERENCES: 16 };
    assert.fail(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return { route: loaded.exports, calls };
}

function request(body, trusted = true) {
  return new Request('http://localhost/api/generate/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(trusted ? { 'x-trusted': '1' } : {}) },
    body: JSON.stringify(body),
  });
}

test('Canvas image intent preview validates input and returns classifier metadata without caching', async () => {
  const { route, calls } = loadRoute();
  const response = await route.POST(request({ prompt: 'Use the linked image', imageReferenceCount: 2, hasMask: false }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, {
    operation: 'reference-generate', classifierStatus: 'used', classifierModelId: 'jev-runtime', classifierMs: 18,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestedMode, 'auto');
  assert.equal(calls[0].isCanvasRequest, true);
  assert.equal(calls[0].prompt, 'Use the linked image');
  assert.equal(calls[0].imageReferenceCount, 2);
});

test('Canvas image intent preview rejects invalid input and unauthenticated calls', async () => {
  const { route, calls } = loadRoute();
  const invalid = await route.POST(request({ prompt: 'invalid', imageReferenceCount: 17, hasMask: false }));
  const unauthenticated = await route.POST(request({ prompt: 'valid', imageReferenceCount: 1, hasMask: false }, false));

  assert.equal(invalid.status, 400);
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls.length, 0);
});

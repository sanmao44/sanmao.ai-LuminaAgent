import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-kind.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const modelKind = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('keeps an explicit category even when capabilities overlap', () => {
  assert.equal(modelKind.resolveModelKind('chat', 'image', ['chat', 'generate']), 'chat');
  assert.equal(modelKind.resolveModelKind('image', 'chat', ['chat', 'video-generate']), 'image');
});

test('infers video before image for an unclassified video-capable model', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'image', ['generate', 'video-generate']), 'video');
});

test('infers image and chat for unclassified models from their capabilities', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['generate']), 'image');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['chat', 'vision']), 'chat');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', []), 'unknown');
});

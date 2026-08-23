import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/generation-source.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { normalizeGenerationSource } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('normalizes only supported generation sources', () => {
  assert.equal(normalizeGenerationSource('canvas', 'workspace'), 'canvas');
  assert.equal(normalizeGenerationSource('agent', 'workspace'), 'agent');
  assert.equal(normalizeGenerationSource('unknown', 'workspace'), 'workspace');
  assert.equal(normalizeGenerationSource(undefined, 'agent'), 'agent');
});

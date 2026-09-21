import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/generate/route.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('generate-route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const helperNames = new Set(['isSafeImageModelFallbackError', 'runImageModelCandidates']);
const helperSource = tree.statements
  .filter((node) => node.name?.text && helperNames.has(node.name.text))
  .map((node) => node.getText(tree))
  .join('\n');
const compiled = ts.transpileModule(`${helperSource}\nreturn { runImageModelCandidates, isSafeImageModelFallbackError };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { runImageModelCandidates, isSafeImageModelFallbackError } = new Function(compiled)();

const runtime = (id) => ({ model: { id } });
const providerRejection = (status) => Object.assign(new Error(`HTTP ${status}`), { providerFailureKind: 'http', providerStatus: status });

test('switches automatic image models only after an explicit compatibility rejection', async () => {
  const calls = [];
  let loaded = 0;
  const first = runtime('default-image');
  const second = runtime('fallback-image');
  const result = await runImageModelCandidates(first, async () => {
    loaded += 1;
    return [first, second];
  }, async (candidate) => {
    calls.push(candidate.model.id);
    if (candidate.model.id === 'default-image') throw providerRejection(422);
    return candidate.model.id;
  });
  assert.equal(result, 'fallback-image');
  assert.deepEqual(calls, ['default-image', 'fallback-image']);
  assert.equal(loaded, 1);
});

test('does not switch after transport or ambiguous server failures', async () => {
  for (const failure of [
    Object.assign(new Error('fetch failed'), { providerFailureKind: 'transport' }),
    Object.assign(new Error('HTTP 500'), { providerFailureKind: 'http', providerStatus: 500 }),
  ]) {
    let loaded = 0;
    await assert.rejects(
      runImageModelCandidates(runtime('default-image'), async () => { loaded += 1; return [runtime('fallback-image')]; }, async () => { throw failure; }),
      failure,
    );
    assert.equal(loaded, 0);
  }
});

test('recognizes only safe compatibility statuses for fallback', () => {
  assert.equal(isSafeImageModelFallbackError(providerRejection(400)), true);
  assert.equal(isSafeImageModelFallbackError(providerRejection(415)), true);
  assert.equal(isSafeImageModelFallbackError(providerRejection(422)), true);
  assert.equal(isSafeImageModelFallbackError(providerRejection(500)), false);
});

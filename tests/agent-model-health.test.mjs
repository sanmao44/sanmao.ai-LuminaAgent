import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/agent/model-health.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const health = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const runtime = (id, provider = 'primary') => ({
  model: { id, displayName: id },
  provider: { id: provider, name: provider },
});

test.beforeEach(() => health.resetAgentModelHealth());

test('automatic candidates move a failed model behind healthy candidates', () => {
  const failed = runtime('failed');
  const healthy = runtime('healthy', 'backup');
  health.noteAgentModelFailure(failed, Object.assign(new Error('503'), { providerFailureKind: 'http', providerStatus: 503 }), 40000);
  assert.deepEqual(health.orderAgentModelCandidates([failed, healthy]).map((item) => item.model.id), ['healthy', 'failed']);
  assert.equal(health.isAgentModelCircuitOpen(failed), true);
});

test('successful recovery clears the circuit and keeps latency for the picker', () => {
  const failed = runtime('recovering');
  health.noteAgentModelFailure(failed, new Error('timeout'), 40000);
  health.noteAgentModelSuccess(failed, 820);
  assert.equal(health.isAgentModelCircuitOpen(failed), false);
  const [record] = health.getAgentModelHealthSnapshot();
  assert.equal(record.state, 'healthy');
  assert.equal(record.lastLatencyMs, 820);
});

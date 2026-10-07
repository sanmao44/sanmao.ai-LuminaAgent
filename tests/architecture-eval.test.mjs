import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { AgentRuntime } = createTsRequire(process.cwd())('./packages/agent-core/runtime');
const { BufferedRuntimeObserver } = createTsRequire(process.cwd())('./packages/contracts/observability');
const schema = createTsRequire(process.cwd())('./lib/backup-schema');

test('architecture eval: compact AgentRun emits a bounded redacted lifecycle', async () => {
  const observer = new BufferedRuntimeObserver(8);
  const runtime = new AgentRuntime({
    model: { invoke: async () => ({ content: 'stable outcome', modelId: 'eval-model' }) },
    context: { build: (request) => request.messages },
    policy: { decide: () => ({ allowed: true }) },
    observer,
  });
  const result = await runtime.run({ runId: 'eval-run', model: { id: 'eval-model', displayName: 'Eval', capabilities: {} }, messages: [{ role: 'user', content: 'fixed input' }] });
  assert.equal(result.output, 'stable outcome');
  assert.deepEqual(observer.snapshot().map((event) => event.phase), ['started', 'completed']);
  assert.equal(JSON.stringify(observer.snapshot()).includes('fixed input'), false);
});

test('architecture eval: legacy backup metadata normalizes to one canonical client boundary', () => {
  const manifest = schema.validateCurrentBackupManifest({ format: 'sanmao-ai-local-backup-archive', version: 2 });
  assert.equal(manifest.schemaVersion, schema.CURRENT_BACKUP_SCHEMA_VERSION);
  assert.deepEqual(manifest.canonical, { workspace: 'client/client.json' });
});

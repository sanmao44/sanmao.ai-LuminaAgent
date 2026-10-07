import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());

test('operational runtime sink persists bounded structured events without sensitive payloads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-runtime-events-'));
  const { FileRuntimeObserver, recentRuntimeEvents } = load('./packages/observability/runtime-sink');
  const observer = new FileRuntimeObserver({ directory, maxFileBytes: 4096 });
  await observer.emit({
    operationId: 'run-1',
    kind: 'tool',
    phase: 'completed',
    at: 100,
    durationMs: 12,
    identity: 'mcp:filesystem:list',
    status: 'completed',
    retry: 1,
    // RuntimeEvent intentionally has no content field; this verifies unknown
    // fields do not cross the sink boundary when a caller provides one.
    content: 'private prompt with token=super-secret-value',
    args: { password: 'super-secret-value' },
  });
  const events = await recentRuntimeEvents({ directory, limit: 10 });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    operationId: 'run-1',
    kind: 'tool',
    phase: 'completed',
    at: 100,
    durationMs: 12,
    identity: 'mcp:filesystem:list',
    status: 'completed',
    retry: 1,
  });
  const files = await (await import('node:fs/promises')).readdir(directory);
  const raw = await readFile(path.join(directory, files[0]), 'utf8');
  assert.equal(raw.includes('private prompt'), false);
  assert.equal(raw.includes('super-secret-value'), false);
});

test('operational runtime sink serializes concurrent emits and returns newest events first', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-runtime-events-order-'));
  const { FileRuntimeObserver, recentRuntimeEvents } = load('./packages/observability/runtime-sink');
  const observer = new FileRuntimeObserver({ directory, maxFileBytes: 4096, now: () => 2_000 });
  await Promise.all([
    observer.emit({ operationId: 'one', kind: 'agent', phase: 'started', at: 1 }),
    observer.emit({ operationId: 'two', kind: 'agent', phase: 'completed', at: 2 }),
  ]);
  const events = await recentRuntimeEvents({ directory, limit: 2 });
  assert.deepEqual(events.map((event) => event.operationId), ['two', 'one']);
});

test('operational sink exposes only redacted events through the read contract', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-runtime-events-api-'));
  const { FileRuntimeObserver, recentRuntimeEvents } = load('./packages/observability/runtime-sink');
  const observer = new FileRuntimeObserver({ directory });
  await observer.emit({ operationId: 'api-run', kind: 'mcp', phase: 'failed', at: Date.now(), errorClass: 'RemoteError', identity: 'server:tool' });
  const events = await recentRuntimeEvents({ directory, limit: 1 });
  assert.equal(events[0].kind, 'mcp');
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], 'content'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], 'args'), false);
});

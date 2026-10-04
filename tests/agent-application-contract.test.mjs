import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contract = createTsRequire(process.cwd())('./apps/api/agent-application-contract');

test('application output contract preserves JSON status and stream metadata', async () => {
  const json = contract.applicationJson({ ok: true }, { status: 202 });
  assert.deepEqual(json, { kind: 'json', body: { ok: true }, status: 202 });

  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {}\n\n')); controller.close(); } });
  const output = contract.applicationStream(stream, { 'X-Run-Id': 'run-1' }, 206);
  assert.equal(output.kind, 'stream');
  assert.equal(output.status, 206);
  assert.deepEqual(output.headers, { 'X-Run-Id': 'run-1' });
  assert.equal(new TextDecoder().decode(await new Response(output.body).arrayBuffer()), 'data: {}\n\n');
});

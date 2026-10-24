import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { normalizeRuntimeOperationPort } = createTsRequire(process.cwd())('./lib/runtime-port');

test('runtime operation ports collapse the legacy automatic range to the canonical origin', () => {
  assert.equal(normalizeRuntimeOperationPort(0), 3210);
  assert.equal(normalizeRuntimeOperationPort(3210), 3210);
  assert.equal(normalizeRuntimeOperationPort(3211), 3210);
  assert.equal(normalizeRuntimeOperationPort(3220), 3210);
  assert.equal(normalizeRuntimeOperationPort(4000), 4000);
  assert.equal(normalizeRuntimeOperationPort(65526), 3210);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { formatStorageBytes } = createTsRequire(process.cwd())('./lib/storage-presentation');

test('storage byte formatting keeps settings display thresholds stable', () => {
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes(1024), '1.0 KB');
  assert.equal(formatStorageBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatStorageBytes(1024 * 1024 * 1024), '1.00 GB');
});

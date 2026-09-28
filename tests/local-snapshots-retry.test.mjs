import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

// 快照密码是模块加载时的环境变量；用一个过短的密码制造必然失败，专门验证失败路径。
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sanmao-snapshot-retry-'));
process.env.SANMAO_DATA_DIR = path.join(tmp, 'data');
process.env.SANMAO_MEDIA_ROOT = path.join(tmp, 'media');
process.env.SANMAO_MASTER_KEY = 'too-short';

const snapshots = createTsRequire(new URL('../lib', import.meta.url).pathname)('./local-snapshots');

test('自动快照失败时向心跳退让并退避，不会每次心跳都重试', async () => {
  const failureLogs = [];
  const originalError = console.error;
  console.error = (...args) => { failureLogs.push(String(args[0])); };
  try {
    assert.equal(await snapshots.ensureLocalSnapshot(), null);
    assert.equal(await snapshots.ensureLocalSnapshot(), null);
    assert.equal(await snapshots.ensureLocalSnapshot(), null);
  } finally {
    console.error = originalError;
  }
  assert.equal(failureLogs.filter((line) => line.includes('[Snapshot]')).length, 1);
});

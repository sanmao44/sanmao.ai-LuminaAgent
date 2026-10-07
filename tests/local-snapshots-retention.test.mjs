import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

// 快照的目录、密码与限额都是模块加载时读环境变量，必须先准备好临时目录再实例化。
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sanmao-snapshot-retention-'));
const dataDir = path.join(tmp, 'data');
const mediaRoot = path.join(tmp, 'media');
process.env.SANMAO_DATA_DIR = dataDir;
process.env.SANMAO_MEDIA_ROOT = mediaRoot;
process.env.SANMAO_MASTER_KEY = 'b'.repeat(64);
// 素材用随机字节，避免 gzip 把体积压没；上限只够放两份左右。
process.env.SANMAO_SNAPSHOT_TOTAL_MAX_BYTES = String(300 * 1024);
process.env.SANMAO_SNAPSHOT_MIN_FREE_BYTES = '0';

const snapshots = createTsRequire(new URL('../lib', import.meta.url).pathname)('./local-snapshots');

async function writeMedia(name, size) {
  await mkdir(path.join(mediaRoot, 'images'), { recursive: true });
  await writeFile(path.join(mediaRoot, 'images', name), randomBytes(size));
}

test('素材没有变化时不重复打包，变化后重新生成', async () => {
  await writeMedia('a.png', 128 * 1024);
  const first = await snapshots.createLocalSnapshot('scheduled');
  assert.equal(first.skipped, false);

  const second = await snapshots.createLocalSnapshot('scheduled');
  assert.equal(second.skipped, true);
  assert.equal(second.path, first.path);

  await writeMedia('b.png', 128 * 1024);
  const third = await snapshots.createLocalSnapshot('scheduled');
  assert.equal(third.skipped, false);
  assert.notEqual(third.path, first.path);
});

test('超过总字节上限时优先保留最新快照', async () => {
  await writeMedia('c.png', 128 * 1024);
  await snapshots.createLocalSnapshot('scheduled');
  await writeMedia('d.png', 128 * 1024);
  const latest = await snapshots.createLocalSnapshot('scheduled');

  const remaining = await snapshots.listLocalSnapshots();
  const total = remaining.reduce((sum, item) => sum + item.bytes, 0);
  assert.equal(remaining[0].path, latest.path, '最新快照必须保留');
  assert.ok(remaining.length <= 3, `裁剪后仍保留 ${remaining.length} 份`);
  assert.ok(total <= 300 * 1024 + latest.bytes, `裁剪后总量 ${total} 超过上限`);
});

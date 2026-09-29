import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

// 回收站目录在模块加载时由 SANMAO_DATA_DIR 决定，必须先设好环境再实例化模块。
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sanmao-media-trash-'));
const dataDir = path.join(tmp, 'data');
process.env.SANMAO_DATA_DIR = dataDir;

const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);
const logs = requireTs('./generation-log');

test('删除视频先移入回收站，超过保留期才清理', async () => {
  const mediaDir = path.join(tmp, 'videos');
  await mkdir(mediaDir, { recursive: true });
  const file = path.join(mediaDir, 'clip.mp4');
  await writeFile(file, 'video-bytes');

  await logs.moveMediaToTrash(file, 'videos');
  const trashDir = path.join(dataDir, 'trash', 'videos');
  const trashed = await readdir(trashDir);
  assert.equal(trashed.length, 1);
  assert.equal(await readFile(path.join(trashDir, trashed[0]), 'utf8'), 'video-bytes');

  await logs.purgeExpiredMediaTrash();
  assert.equal((await readdir(trashDir)).length, 1, '未过期时必须保留');

  const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await utimes(path.join(trashDir, trashed[0]), expired, expired);
  await logs.purgeExpiredMediaTrash();
  assert.equal((await readdir(trashDir)).length, 0, '超过保留期后必须清理');
});

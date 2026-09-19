import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

// 媒体目录在模块加载时读取环境变量，必须先准备好临时目录再实例化模块。
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sanmao-snapshot-media-'));
const dataDir = path.join(tmp, 'data');
const mediaRoot = path.join(tmp, 'media');
process.env.SANMAO_DATA_DIR = dataDir;
process.env.SANMAO_MEDIA_ROOT = mediaRoot;
process.env.SANMAO_MASTER_KEY = 'a'.repeat(64);

const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);
const snapshots = requireTs('./local-snapshots');
const archive = requireTs('./backup-archive');
const crypto = requireTs('./backup-crypto');

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const video = Buffer.alloc(4096, 3);
const audio = Buffer.alloc(2048, 5);
const mediaFiles = [
  ['images', 'sample.png', image],
  ['videos', 'sample.mp4', video],
  ['audio', 'sample.mp3', audio],
];

for (const [folder, name, data] of mediaFiles) {
  await mkdir(path.join(mediaRoot, folder), { recursive: true });
  await writeFile(path.join(mediaRoot, folder, name), data);
}

test('快照把视频、音频和图片一起打包', async () => {
  const snapshot = await snapshots.createLocalSnapshot('test');
  assert.equal(snapshot.imageCount, 1);
  assert.equal(snapshot.videoCount, 1);
  assert.equal(snapshot.audioCount, 1);

  const raw = await readFile(snapshot.path);
  const entries = archive.extractBackupArchive(crypto.decryptBackupPayload(raw, process.env.SANMAO_MASTER_KEY));
  const manifest = JSON.parse(entries.find((entry) => entry.name === 'manifest.json').data.toString('utf8'));
  assert.deepEqual(manifest.media, { videos: 1, audio: 1, images: 1, skipped: 0 });
  assert.deepEqual(
    entries.map((entry) => entry.name).filter((name) => name.startsWith('videos/') || name.startsWith('audio/') || name.startsWith('images/')).sort(),
    ['audio/sample.mp3', 'images/sample.png', 'videos/sample.mp4'],
  );
  assert.deepEqual(entries.find((entry) => entry.name === 'videos/sample.mp4').data, video);
});

test('媒体文件丢失后可以按快照恢复回来', async () => {
  for (const [folder, name] of mediaFiles) await rm(path.join(mediaRoot, folder, name), { force: true });
  const [snapshot] = await snapshots.listLocalSnapshots();

  const restored = await snapshots.restoreLocalSnapshot(snapshot.path, '');
  assert.equal(restored.restoredImages, 1);
  assert.equal(restored.restoredVideos, 1);
  assert.equal(restored.restoredAudio, 1);
  for (const [folder, name, data] of mediaFiles) {
    assert.deepEqual(await readFile(path.join(mediaRoot, folder, name)), data);
  }
});

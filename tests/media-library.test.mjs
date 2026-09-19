import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-media-data-'));
const mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-media-root-'));
// storage 模块在导入时读取 SANMAO_DATA_DIR，因此必须在加载前设定。
process.env.SANMAO_DATA_DIR = dataDir;
process.env.SANMAO_MEDIA_ROOT = mediaRoot;

const { main: mediaLibrary, load } = await buildLibModules(
  [
    'lib/data-paths',
    'lib/media-paths',
    'lib/image-storage',
    'lib/video-storage',
    'lib/audio-storage',
    'lib/media-library',
  ],
  'media-library',
);
const mediaPaths = await load('media-paths');
const imageStorage = await load('image-storage');
const videoStorage = await load('video-storage');

test.after(async () => {
  delete process.env.SANMAO_MEDIA_ROOT;
  delete process.env.SANMAO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(mediaRoot, { recursive: true, force: true });
});

async function writeMedia(folder, name, contents) {
  const target = path.join(dataDir, folder);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, name), contents);
}

test('defaults the media root to the user-level library', () => {
  const previous = process.env.SANMAO_MEDIA_ROOT;
  delete process.env.SANMAO_MEDIA_ROOT;
  try {
    assert.equal(mediaPaths.resolveMediaRootDir(), path.join(os.homedir(), '.sanmao-ai', 'media'));
    assert.equal(mediaPaths.resolveMediaRootDir('C:/tmp/work', 'media'), path.resolve('C:/tmp/work', 'media'));
  } finally {
    process.env.SANMAO_MEDIA_ROOT = previous;
  }
});

test('keeps historical run directories reachable for every media kind', async () => {
  await writeMedia('images', 'legacy.png', 'image-bytes');
  await writeMedia('videos', 'legacy.mp4', 'video-bytes');
  await writeMedia('audio', 'legacy.mp3', 'audio-bytes');

  assert.ok(imageStorage.getStorageRoots('').map((item) => path.resolve(item)).includes(path.resolve(path.join(dataDir, 'images'))));
  assert.ok(videoStorage.getVideoStorageRoots('').map((item) => path.resolve(item)).includes(path.resolve(path.join(dataDir, 'videos'))));

  assert.equal(path.resolve(imageStorage.resolveStoredFileWithFallback('', 'legacy.png')), path.resolve(path.join(dataDir, 'images', 'legacy.png')));
  assert.equal(path.resolve(videoStorage.resolveStoredVideoFileWithFallback('', 'legacy.mp4')), path.resolve(path.join(dataDir, 'videos', 'legacy.mp4')));
});

test('merges legacy media into the fixed library without deleting sources', async () => {
  await writeMedia('images', 'keep.png', 'image-bytes');
  await writeMedia('videos', 'keep.mp4', 'video-bytes');
  await writeMedia('audio', 'keep.mp3', 'audio-bytes');

  const summary = await mediaLibrary.runMediaLibraryMerge();
  assert.equal(summary.root, path.resolve(mediaRoot));
  assert.ok(summary.copied.image >= 1);
  assert.ok(summary.copied.video >= 1);
  assert.ok(summary.copied.audio >= 1);
  assert.ok(existsSync(path.join(mediaRoot, 'images', 'keep.png')));
  assert.ok(existsSync(path.join(mediaRoot, 'videos', 'keep.mp4')));
  assert.ok(existsSync(path.join(mediaRoot, 'audio', 'keep.mp3')));
  assert.equal(await readFile(path.join(dataDir, 'videos', 'keep.mp4'), 'utf8'), 'video-bytes');
});

test('never overwrites an existing library file and reports it as present', async () => {
  await writeMedia('videos', 'duplicate.mp4', 'old-bytes');
  await mediaLibrary.runMediaLibraryMerge();
  assert.equal(await readFile(path.join(mediaRoot, 'videos', 'duplicate.mp4'), 'utf8'), 'old-bytes');

  await writeMedia('videos', 'duplicate.mp4', 'new-bytes');
  const summary = await mediaLibrary.runMediaLibraryMerge();
  assert.equal(summary.copied.video, 0);
  assert.ok(summary.present.video >= 1);
  assert.equal(await readFile(path.join(mediaRoot, 'videos', 'duplicate.mp4'), 'utf8'), 'old-bytes');
});

test('remembers merged sources so later lookups still resolve them', async () => {
  await mediaLibrary.runMediaLibraryMerge();
  const registered = mediaPaths.knownMediaRoots('video').map((item) => path.resolve(item));
  assert.ok(registered.includes(path.resolve(path.join(dataDir, 'videos'))));
});

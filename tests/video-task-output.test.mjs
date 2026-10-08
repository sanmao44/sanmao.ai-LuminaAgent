import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const output = createTsRequire(process.cwd())('./lib/video-task-output');
const catalog = createTsRequire(process.cwd())('./lib/asset-catalog');

test('local video archives are authoritative and do not create duplicate assets', () => {
  const task = {
    id: 'video-1',
    videoUrls: ['/api/storage/video?name=video.mp4'],
    remoteVideoUrls: ['https://provider.example/video.mp4'],
    input: { prompt: 'test video' },
  };

  assert.deepEqual(output.videoTaskOutputUrls(task), ['/api/storage/video?name=video.mp4']);
  assert.equal(output.videoTaskOutputUrl(task), '/api/storage/video?name=video.mp4');
  assert.equal(catalog.videoAssets([task]).length, 1);
  assert.equal(catalog.videoAssets([task])[0].url, '/api/storage/video?name=video.mp4');
});

test('remote video URLs remain available when local archiving failed', () => {
  const task = {
    videoUrls: [],
    remoteVideoUrls: ['https://provider.example/video.mp4'],
  };

  assert.deepEqual(output.videoTaskOutputUrls(task), ['https://provider.example/video.mp4']);
  assert.equal(output.videoTaskStatus({ ...task, status: 'running' }), 'done');
});

test('worker removal accepts a task with a result even when its stored status is stale', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-remove-'));
  const mediaFile = path.join(dataDir, 'video.mp4');
  process.env.SANMAO_DATA_DIR = dataDir;
  await writeFile(mediaFile, 'video');

  const store = createTsRequire(process.cwd())('./lib/video-task-store');
  const worker = createTsRequire(process.cwd())('./apps/worker/task-control');
  const created = await store.createVideoTask({
    providerId: 'provider-1',
    modelId: 'model-1',
    operation: 'generate',
    status: 'running',
    idempotencyKey: 'remove-stale-running',
    input: { prompt: 'stale running task' },
  });
  await store.updateVideoTask(created.task.id, {
    videoUrls: ['/api/storage/video?name=video.mp4'],
    remoteVideoUrls: ['https://provider.example/video.mp4'],
    localVideoPaths: [mediaFile],
  });

  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const removed = await worker.removeVideoTask(created.task.id);
  assert.equal(removed?.id, created.task.id);
  assert.equal(await store.findVideoTask(created.task.id), null);
});

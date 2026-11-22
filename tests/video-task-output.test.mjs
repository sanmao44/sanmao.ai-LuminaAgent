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

test('video task errors are summarized safely and keep diagnostics actionable', () => {
  const local = output.videoTaskErrorPresentation('EPERM: rename C:\\Users\\wc103\\.data\\agnes-media\\manifest.json.tmp -> C:\\Users\\wc103\\.data\\agnes-media\\manifest.json', { localArchiveFailed: true });
  assert.equal(local.summary, '视频已生成，但本机保存失败，可再次保存');
  assert.match(local.detail, /\[本机路径\]/);
  assert.doesNotMatch(local.detail, /C:\\Users/);

  const transient = output.videoTaskErrorPresentation('fetch failed: 503 temporary network error');
  assert.equal(transient.summary, '服务商或网络暂时不可用，可稍后重试');

  const provider = output.videoTaskErrorPresentation('provider rejected prompt');
  assert.equal(provider.summary, '视频生成失败，可恢复参数后重新提交');
});

test('error copy only reports an existing video when task output confirms it', () => {
  assert.equal(output.videoTaskErrorPresentation('write request failed').summary, '视频生成失败，可恢复参数后重新提交');
  assert.equal(output.videoTaskErrorPresentation('query failed', { isTracking: true }).summary, '任务状态暂时无法更新，正在继续查询');
  assert.equal(output.videoTaskErrorPresentation('download failed', { hasRemoteOutput: true }).summary, '视频已生成，但本机保存失败，可再次保存');
  assert.equal(output.videoTaskErrorPresentation(''), null);
});

test('technical error details redact credentials and limit long provider responses', () => {
  const result = output.videoTaskErrorPresentation('Authorization: Bearer fixture-secret token=fixture-token api_key="fixture-key" https://example.test?key=fixture-query');
  assert.doesNotMatch(result.detail, /fixture-(?:secret|token|key|query)/);
  assert.ok(output.videoTaskErrorPresentation('x'.repeat(1000)).detail.length <= 600);
});

test('technical details hide complete Basic and Digest authorization and OAuth tokens', () => {
  for (const error of [
    'Authorization: Basic RklYVFVSRTpTRUNSRVQ=',
    'Authorization: Digest username="fixture-user", response="fixture-secret"',
    '{"authorization":"Basic fixture-secret","message":"request failed"}',
    JSON.stringify({ authorization: 'Digest username="fixture-user", response="fixture-secret"', message: 'request failed' }),
    'https://example.test?access_token=fixture-access&refresh_token=fixture-refresh&client_secret=fixture-secret',
    'access_token=fixture-access refresh_token="fixture-refresh" client_secret=fixture-secret',
  ]) {
    const { detail } = output.videoTaskErrorPresentation(error);
    assert.doesNotMatch(detail, /fixture-(?:user|secret|access|refresh)|RklYVFVSRTpTRUNSRVQ=/);
  }
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

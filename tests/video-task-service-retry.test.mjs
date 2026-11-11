import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function createHarness(submissionErrors) {
  const finishedLogs = [];
  let currentTask;
  let submitCount = 0;
  const provider = { id: 'provider-1', name: 'relay fixture', platform: 'custom', videoTransport: 'openai-videos' };
  const model = { id: 'model-1', rawId: 'fixture-video', displayName: 'Fixture video' };
  const runtime = { provider, model };
  const limits = {
    minSeconds: 1,
    maxSeconds: 60,
    resolutions: ['720p'],
    maxReferenceImages: 16,
    maxReferenceVideos: 10,
    maxAudios: 10,
    notes: [],
  };
  class VideoProviderError extends Error {
    constructor(message, options = {}) {
      super(message);
      Object.assign(this, options);
    }
  }

  const service = createTsRequire(process.cwd(), {
    './generation-log': {
      startGenerationLog: async () => undefined,
      finishGenerationLog: async (_id, log) => { finishedLogs.push(log); },
    },
    './store': {
      getPublicState: async () => ({ settings: { videoStoragePath: '' } }),
      getProviderWithKey: async () => provider,
      getRuntimeVideoModel: async () => runtime,
      markProviderCredentialFailure: async () => undefined,
    },
    './video-storage': { persistGeneratedVideos: async () => ({ videos: [], path: '' }) },
    './video-task-store': {
      createVideoTask: async (input) => {
        currentTask = {
          ...input,
          id: 'task-1',
          createdAt: new Date().toISOString(),
          pollCount: 0,
          videoUrls: [],
          remoteVideoUrls: [],
          localVideoPaths: [],
        };
        return { created: true, task: currentTask };
      },
      findVideoTask: async () => currentTask,
      findVideoTaskByIdempotencyKey: async (key) => currentTask?.idempotencyKey === key ? currentTask : null,
      updateVideoTask: async (_id, patch) => {
        currentTask = { ...currentTask, ...patch };
        return currentTask;
      },
    },
    './video-providers': {
      idempotencyKey: () => 'generated-key',
      pollJimengVideo: async () => { throw new Error('unused'); },
      pollRemoteVideo: async () => { throw new Error('unused'); },
      runJimengVideo: async () => { throw new Error('unused'); },
      submitRemoteVideo: async () => {
        submitCount += 1;
        const error = submissionErrors.shift();
        if (error) throw error;
        return { status: 'pending', videos: [] };
      },
      VideoProviderError,
    },
    './video-model-limits': {
      getVideoModelLimits: () => limits,
      VIDEO_INPUT_SAFETY_LIMITS: { maxReferenceImages: 16, maxReferenceVideos: 10, maxAudios: 10 },
    },
    './video-platform': {
      is65535Provider: () => false,
      isJimengProvider: () => false,
      isAgnesProvider: () => false,
    },
    './video-input-media': { prepareVideoInputMedia: async (input) => input },
    './video-task-runtime': {
      canRetryVideoTask: () => true,
      isStaleVideoTask: () => false,
      videoTaskRuntime: { isActive: () => true },
    },
    '@/packages/contracts/observability': {
      BufferedRuntimeObserver: class { async emit() {} },
    },
  })('./lib/video-task-service');

  return {
    service,
    finishedLogs,
    task: () => currentTask,
    makeRetryEligible: () => { currentTask = { ...currentTask, nextPollAt: Date.now() - 1 }; },
    submitCount: () => submitCount,
  };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

test('fails a video task when relay configuration is missing, even when the message suggests retrying', async () => {
  const harness = createHarness([
    codedError('AGNES_MEDIA_RELAY_REQUIRED', '自动中转服务尚未连接，请稍后重试或配置公网地址。'),
  ]);

  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'request-1',
    input: { prompt: 'fixture prompt', seconds: 5 },
  });

  assert.equal(task.status, 'failed');
  assert.equal(task.errorCode, 'AGNES_MEDIA_RELAY_REQUIRED');
  assert.equal(task.nextPollAt, undefined);
  assert.equal(harness.submitCount(), 1);
  assert.equal(harness.finishedLogs[0].errorCode, 'AGNES_MEDIA_RELAY_REQUIRED');
});

test('keeps transient relay outages pending, then fails a retry when relay configuration is missing', async () => {
  const harness = createHarness([
    codedError('AGNES_MEDIA_RELAY_UNAVAILABLE', '自动中转服务暂时不可用，请稍后重试。'),
    codedError('AGNES_MEDIA_RELAY_REQUIRED', '自动中转服务尚未连接，请稍后重试或配置公网地址。'),
  ]);

  const pending = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'request-2',
    input: { prompt: 'fixture prompt', seconds: 5 },
  });

  assert.equal(pending.status, 'pending');
  assert.ok(pending.nextPollAt > Date.now());
  assert.match(pending.error, /任务已保留/);

  harness.makeRetryEligible();
  const failed = await harness.service.refreshVideoTask('task-1');

  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'AGNES_MEDIA_RELAY_REQUIRED');
  assert.equal(failed.nextPollAt, undefined);
  assert.equal(harness.submitCount(), 2);
  assert.equal(harness.finishedLogs.at(-1).errorCode, 'AGNES_MEDIA_RELAY_REQUIRED');
});

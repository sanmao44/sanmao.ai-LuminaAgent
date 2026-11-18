import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { buildCangyuanVideoPayload } = createTsRequire(process.cwd())('./lib/cangyuan-video-capabilities');

function createHarness(submissionErrors, videoTransport = 'openai-videos', rawModelId = 'fixture-video', mediaPreparer = async (value) => value, providerOverrides = {}) {
  const finishedLogs = [];
  let currentTask;
  let submitCount = 0;
  let submittedInput;
  let pollResult;
  const provider = { id: 'provider-1', name: 'relay fixture', platform: 'custom', videoTransport, ...providerOverrides };
  const model = { id: 'model-1', rawId: rawModelId, displayName: 'Fixture video' };
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
      updateActiveVideoTask: async (_id, patch) => {
        if (!currentTask || !['pending', 'running'].includes(currentTask.status)) return null;
        currentTask = { ...currentTask, ...patch };
        return currentTask;
      },
    },
    './video-providers': {
      idempotencyKey: () => 'generated-key',
      pollJimengVideo: async () => { throw new Error('unused'); },
      pollRemoteVideo: async () => {
        if (!pollResult) throw new Error('unused');
        return pollResult;
      },
      runJimengVideo: async () => { throw new Error('unused'); },
      submitRemoteVideo: async (_provider, _modelId, input) => {
        submitCount += 1;
        submittedInput = input;
        const error = submissionErrors.shift();
        if (error) throw error;
        return { status: 'pending', videos: [] };
      },
      VideoProviderError,
    },
    './video-model-limits': {
      getVideoModelLimits: () => limits,
      getVideoModelLimitsForInput: () => limits,
      VIDEO_INPUT_SAFETY_LIMITS: { maxReferenceImages: 16, maxReferenceVideos: 10, maxAudios: 10 },
    },
    './video-platform': {
      is65535Provider: () => false,
      isJimengProvider: () => false,
      isAgnesProvider: () => false,
    },
    './video-input-media': { prepareVideoInputMedia: async (input) => input },
    './signed-media': { preparePublicMediaUrl: mediaPreparer },
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
    setProviderTaskId: (providerTaskId) => { currentTask = { ...currentTask, providerTaskId }; },
    submitCount: () => submitCount,
    submittedInput: () => submittedInput,
    VideoProviderError,
    pushSubmissionError: (error) => submissionErrors.push(error),
    setPollResult: (result) => { pollResult = result; },
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

test('rejects unsupported Cangyuan video settings before creating a task', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  await assert.rejects(
    () => harness.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-custom-duration',
      input: { prompt: 'fixture prompt', seconds: 8, aspectRatio: '16:9', resolution: '720p', seed: 4 },
    }),
    /不支持或未核实.*seed/,
  );
  assert.equal(harness.task(), undefined);
  assert.equal(harness.submitCount(), 0);
});

test('detects Cangyuan video providers from legacy platform and API host when transport is auto', async () => {
  for (const providerOverrides of [
    { platform: 'cangyuan' },
    { platform: 'custom', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1' },
  ]) {
    const harness = createHarness([], 'auto', 'sd20-seedance-2.0-fast', undefined, providerOverrides);
    await assert.rejects(
      () => harness.service.createVideoGeneration({
        modelId: 'model-1',
        idempotencyKey: 'legacy-cangyuan-auto',
        input: { prompt: 'fixture prompt', seconds: 8, aspectRatio: '16:9', seed: 4 },
      }),
      /不支持或未核实.*seed/,
    );
    assert.equal(harness.task(), undefined);
    assert.equal(harness.submitCount(), 0);
  }
});

test('keeps an explicit non-Cangyuan video transport ahead of legacy provider identity', async () => {
  const harness = createHarness([], 'openai-videos', 'fixture-video', undefined, { platform: 'cangyuan' });
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'explicit-openai-transport',
    input: { prompt: 'fixture prompt', seconds: 8, aspectRatio: '16:9', resolution: '720p' },
  });
  assert.equal(task.status, 'pending');
  assert.equal(harness.submitCount(), 1);
});

test('persists Cangyuan final progress and reported token usage to the task and generation log', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'sd25-seedance-2.0');
  await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-progress-usage',
    input: { prompt: 'A quiet sunrise', seconds: 5, aspectRatio: '16:9' },
  });
  harness.setPollResult({
    status: 'done',
    providerTaskId: 'cangyuan-video-1',
    progress: 100,
    usage: { completionTokens: 121, totalTokens: 128 },
    videos: [{ url: 'https://cdn.example/cangyuan-final.mp4' }],
  });
  harness.setProviderTaskId('cangyuan-video-1');
  harness.makeRetryEligible();

  const completed = await harness.service.refreshVideoTask('task-1');

  assert.equal(completed.status, 'done');
  assert.equal(completed.providerProgress, 100);
  assert.deepEqual(completed.providerUsage, { completionTokens: 121, totalTokens: 128 });
  assert.equal(harness.finishedLogs[0].completionTokens, 121);
  assert.equal(harness.finishedLogs[0].totalTokens, 128);
  assert.equal(harness.finishedLogs[0].costUsd, undefined);
});

test('preserves disabled Cangyuan audio generation through task input cleaning and payload creation', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'sd25-seedance-2.0');
  await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-generate-audio-disabled',
    input: { prompt: 'A quiet sunrise', seconds: 5, aspectRatio: '16:9', generateAudio: false },
  });

  assert.equal(harness.task().input.generateAudio, false);
  assert.equal(harness.submittedInput().generateAudio, false);
  assert.equal(buildCangyuanVideoPayload('sd25-seedance-2.0', harness.submittedInput()).generate_audio, false);
});

test('preserves documented Cangyuan advanced parameters in task state and provider input', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'mu1-muse-video');
  await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-advanced-parameters',
    input: {
      prompt: 'A night city scene',
      modelParameters: { camera_movement: 'slow orbit', negative_prompt: 'watermark' },
    },
  });

  assert.deepEqual(harness.task().input.modelParameters, { camera_movement: 'slow orbit', negative_prompt: 'watermark' });
  assert.deepEqual(harness.submittedInput().modelParameters, { camera_movement: 'slow orbit', negative_prompt: 'watermark' });
  assert.deepEqual(buildCangyuanVideoPayload('mu1-muse-video', harness.submittedInput()).camera_movement, 'slow orbit');
});

test('validates Seedance Fast duration and line-specific frame constraints before task creation', async () => {
  const invalidDuration = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  await assert.rejects(
    () => invalidDuration.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-invalid-duration',
      input: { prompt: 'fixture prompt', seconds: 16, aspectRatio: '16:9' },
    }),
    /4–15 秒的整数/,
  );
  assert.equal(invalidDuration.task(), undefined);
  assert.equal(invalidDuration.submitCount(), 0);

  const unpairedFrame = createHarness([], 'cangyuan-videos', 'sd25-seedance-2.0');
  await assert.rejects(
    () => unpairedFrame.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-unpaired-frame',
      input: { prompt: 'fixture prompt', seconds: 5, lastFrame: 'https://assets.example/last.png' },
    }),
    /使用尾帧时必须同时提供首帧/,
  );
  assert.equal(unpairedFrame.task(), undefined);
  assert.equal(unpairedFrame.submitCount(), 0);

  const mixedInputs = createHarness([], 'cangyuan-videos', 'sd14-seedance-2.0');
  await assert.rejects(
    () => mixedInputs.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-frame-reference-mix',
      input: {
        prompt: 'fixture prompt',
        firstFrame: 'https://assets.example/first.png',
        lastFrame: 'https://assets.example/last.png',
        referenceImages: ['https://assets.example/reference.png'],
      },
    }),
    /首尾帧不能与参考图、参考视频或参考音频同时使用/,
  );
  assert.equal(mixedInputs.task(), undefined);
  assert.equal(mixedInputs.submitCount(), 0);
});

test('validates Seedance Fast reference count and HTTPS source before task creation', async () => {
  const tooManyReferences = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  await assert.rejects(
    () => tooManyReferences.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-too-many-references',
      input: { prompt: 'fixture prompt', seconds: 5, aspectRatio: '16:9', referenceImages: Array.from({ length: 10 }, (_, index) => `https://assets.example/${index}.png`) },
    }),
    /最多接收 9 张参考图/,
  );
  assert.equal(tooManyReferences.task(), undefined);
  assert.equal(tooManyReferences.submitCount(), 0);

  const localReference = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  await assert.rejects(
    () => localReference.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-local-reference',
      input: { prompt: 'fixture prompt', seconds: 5, aspectRatio: '16:9', referenceImages: ['http://localhost/reference.png'] },
    }),
    /公网 HTTPS URL/,
  );
  assert.equal(localReference.task(), undefined);
  assert.equal(localReference.submitCount(), 0);
});

test('relays local Cangyuan reference media before enforcing the public HTTPS requirement', async () => {
  const prepared = [];
  const harness = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast', async (value, kind) => {
    prepared.push({ value, kind });
    return `https://relay.example/${kind}/${prepared.length}`;
  });
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-local-media-relay',
    input: {
      prompt: 'animate these references',
      seconds: 5,
      aspectRatio: '16:9',
      referenceImages: ['data:image/png;base64,AA=='],
      referenceVideos: ['C:\\assets\\reference.mp4'],
      audios: ['C:\\assets\\reference.wav'],
    },
  });

  assert.equal(task.status, 'pending');
  assert.deepEqual(prepared.map(({ kind }) => kind).sort(), ['audio', 'image', 'video']);
  assert.match(task.input.referenceImages[0], /^https:\/\/relay\.example\/image\//);
  assert.match(task.input.referenceVideos[0], /^https:\/\/relay\.example\/video\//);
  assert.match(task.input.audios[0], /^https:\/\/relay\.example\/audio\//);
});

test('surfaces a missing Cangyuan media relay before creating a task', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast', async () => {
    throw codedError('AGNES_MEDIA_RELAY_REQUIRED', '自动中转服务尚未连接，请配置公网地址。');
  });
  await assert.rejects(
    () => harness.service.createVideoGeneration({
      modelId: 'model-1',
      idempotencyKey: 'cangyuan-relay-required',
      input: { prompt: 'animate this reference', seconds: 5, aspectRatio: '16:9', referenceImages: ['data:image/png;base64,AA=='] },
    }),
    (error) => error.code === 'AGNES_MEDIA_RELAY_REQUIRED' && /自动中转服务尚未连接/.test(error.message),
  );
  assert.equal(harness.task(), undefined);
  assert.equal(harness.submitCount(), 0);
});

test('preserves Cangyuan defaults and schedules the first provider poll after five seconds', async () => {
  const harness = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  const before = Date.now();
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-defaults',
    input: { prompt: 'fixture prompt', seconds: 5, aspectRatio: '16:9', resolution: '720p' },
  });
  assert.equal(task.status, 'pending');
  assert.ok(task.nextPollAt >= before + 4_900);
  assert.ok(task.nextPollAt <= Date.now() + 5_100);
});

test('does not resubmit Cangyuan after a POST response is lost', async () => {
  const retryHarness = createHarness([], 'cangyuan-videos', 'sd20-seedance-2.0-fast');
  retryHarness.pushSubmissionError(new retryHarness.VideoProviderError('fetch failed', { possiblyAccepted: true }));
  const task = await retryHarness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'cangyuan-unconfirmed',
    input: { prompt: 'fixture prompt', seconds: 8, aspectRatio: '16:9' },
  });
  assert.equal(task.status, 'failed');
  assert.equal(task.errorCode, 'CANGYUAN_SUBMISSION_UNCONFIRMED');
  assert.match(task.error, /无法确认任务是否创建/);
  assert.equal(retryHarness.submitCount(), 1);
  assert.equal(task.input.seconds, 8);
});

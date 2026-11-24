import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { buildCangyuanVideoPayload } = createTsRequire(process.cwd())('./lib/cangyuan-video-capabilities');
const { resolveVideoTransport } = createTsRequire(process.cwd())('./lib/video-providers');
const videoModelLimits = createTsRequire(process.cwd())('./lib/video-model-limits');
const { canRecoverVideoTaskResult } = createTsRequire(process.cwd(), {
  './repositories/task-repository': { createTaskRepository: () => ({}) },
})('./lib/video-task-store');

function createHarness(submissionErrors, videoTransport = 'openai-videos', rawModelId = 'fixture-video', mediaPreparer = async (value) => value, providerOverrides = {}, useRealLimits = false) {
  const finishedLogs = [];
  const tasks = new Map();
  let currentTask;
  let submitCount = 0;
  let submittedInput;
  const submittedKeys = [];
  let pollResult;
  let pollCount = 0;
  let submitHandler;
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
  const retryStore = createTsRequire(process.cwd(), {
    './repositories/task-repository': { createTaskRepository: () => ({ mutate: async (callback) => callback([...tasks.values()]) }) },
  })('./lib/video-task-store');
  const patchTask = (patch, id = currentTask?.id) => {
    const previous = tasks.get(id);
    if (!previous) return null;
    const updated = { ...previous, ...patch };
    tasks.set(id, updated);
    if (currentTask?.id === id) currentTask = updated;
    return updated;
  };

  const loadService = () => createTsRequire(process.cwd(), {
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
      canRecoverVideoTaskResult: (task) => canRecoverVideoTaskResult(task),
      claimFailedVideoTaskRetry: retryStore.claimFailedVideoTaskRetry,
      releaseFailedVideoTaskRetry: retryStore.releaseFailedVideoTaskRetry,
      resumeVideoTaskResultRecovery: async (id, now = Date.now()) => {
        if (!canRecoverVideoTaskResult(tasks.get(id))) return null;
        return patchTask({ status: 'pending', error: undefined, errorCode: undefined, completedAt: undefined, nextPollAt: now, resultRecoveryStartedAt: now }, id);
      },
      VIDEO_TASK_SUBMISSION_TIMEOUT_MS: 5 * 60_000,
      claimVideoTaskSubmission: async (id, now = Date.now()) => {
        const task = tasks.get(id);
        if (!task || !['pending', 'running'].includes(task.status)
          || task.providerTaskId || task.errorCode !== 'VIDEO_SUBMISSION_RETRY'
          || task.nextPollAt > now) return null;
        return patchTask({ errorCode: 'VIDEO_SUBMISSION_IN_PROGRESS', nextPollAt: now + 5 * 60_000 }, id);
      },
      createVideoTask: async (input) => {
        const existing = [...tasks.values()].find((task) => task.idempotencyKey === input.idempotencyKey);
        if (existing) return { created: false, task: existing };
        currentTask = {
          ...input,
          id: `task-${tasks.size + 1}`,
          createdAt: new Date().toISOString(),
          pollCount: 0,
          videoUrls: [],
          remoteVideoUrls: [],
          localVideoPaths: [],
        };
        tasks.set(currentTask.id, currentTask);
        return { created: true, task: currentTask };
      },
      findVideoTask: async (id) => tasks.get(id),
      findVideoTaskByIdempotencyKey: async (key) => [...tasks.values()].find((task) => task.idempotencyKey === key) || null,
      updateVideoTask: async (id, patch) => patchTask(patch, id),
      updateActiveVideoTask: async (id, patch) => {
        if (!['pending', 'running'].includes(tasks.get(id)?.status)) return null;
        return patchTask(patch, id);
      },
    },
    './video-providers': {
      resolveVideoTransport,
      idempotencyKey: () => 'generated-key',
      pollJimengVideo: async () => { throw new Error('unused'); },
      pollRemoteVideo: async () => {
        pollCount += 1;
        if (!pollResult) throw new Error('unused');
        if (pollResult instanceof Error) throw pollResult;
        return pollResult;
      },
      runJimengVideo: async () => { throw new Error('unused'); },
      submitRemoteVideo: async (_provider, _modelId, input, key) => {
        submitCount += 1;
        submittedInput = input;
        submittedKeys.push(key);
        if (submitHandler) return submitHandler(input, submitCount);
        const error = submissionErrors.shift();
        if (error) throw error;
        return { status: 'pending', videos: [] };
      },
      VideoProviderError,
    },
    './video-model-limits': {
      getVideoModelLimits: useRealLimits ? videoModelLimits.getVideoModelLimits : () => limits,
      getVideoModelLimitsForInput: useRealLimits ? videoModelLimits.getVideoModelLimitsForInput : () => limits,
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
      videoTaskRuntime: { isActive: (status) => ['pending', 'running'].includes(status) },
    },
    '@/packages/contracts/observability': {
      BufferedRuntimeObserver: class { async emit() {} },
    },
  })('./lib/video-task-service');
  const service = loadService();

  return {
    service,
    loadService,
    finishedLogs,
    task: (id) => id ? tasks.get(id) : currentTask,
    makeRetryEligible: () => { patchTask({ nextPollAt: Date.now() - 1 }); },
    setProviderTaskId: (providerTaskId) => { patchTask({ providerTaskId }); },
    submitCount: () => submitCount,
    pollCount: () => pollCount,
    submittedInput: () => submittedInput,
    submittedKeys: () => submittedKeys,
    VideoProviderError,
    pushSubmissionError: (error) => submissionErrors.push(error),
    setPollResult: (result) => { pollResult = result; },
    setSubmitHandler: (handler) => { submitHandler = handler; },
    patchTask,
  };
}

for (const rawModelId of ['kl1-kling-3.0', 'kl2-kling-3.0', 'kling-3.0-omni', 've1-veo-3.1-fast', 'veo-3.1-fast']) {
  test(`${rawModelId} accepts documented first/last frames without treating them as reference images`, async () => {
    for (const lastFrame of [undefined, 'https://assets.example/last.png']) {
      const harness = createHarness([], 'cangyuan-videos', rawModelId, undefined, {}, true);
      const task = await harness.service.createVideoGeneration({
        modelId: 'model-1',
        idempotencyKey: `first-frame-${rawModelId}-${Boolean(lastFrame)}`,
        input: { prompt: 'animate this frame', seconds: 8, firstFrame: 'https://assets.example/first.png', ...(lastFrame ? { lastFrame } : {}) },
      });
      assert.equal(task.status, 'pending');
      assert.equal(harness.submitCount(), 1);
      assert.equal(harness.submittedInput().firstFrame, 'https://assets.example/first.png');
      assert.equal(harness.submittedInput().lastFrame, lastFrame);
      assert.deepEqual(harness.submittedInput().referenceImages, []);
    }
  });

  test(`${rawModelId} still rejects unsupported reference media before any submission`, async () => {
    for (const unsupportedMedia of [
      { referenceImages: ['https://assets.example/reference.png'] },
      { referenceVideos: ['https://assets.example/reference.mp4'] },
      { audios: ['https://assets.example/reference.wav'] },
    ]) {
      const harness = createHarness([], 'cangyuan-videos', rawModelId, undefined, {}, true);
      await assert.rejects(() => harness.service.createVideoGeneration({
        modelId: 'model-1',
        idempotencyKey: `unsupported-reference-${rawModelId}`,
        input: { prompt: 'animate this frame', seconds: 8, firstFrame: 'https://assets.example/first.png', ...unsupportedMedia },
      }), /不支持.*参考/);
      assert.equal(harness.task(), undefined);
      assert.equal(harness.submitCount(), 0);
    }
  });
}

test('Cangyuan podcast preserves its documented 30–1800 second duration without truncating it to a short video', async () => {
  for (const seconds of [30, 120, 1800]) {
    const harness = createHarness([], 'cangyuan-videos', 'mu1-muse-podcast', undefined, {}, true);
    const task = await harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: `podcast-duration-${seconds}`, input: { prompt: 'discuss creativity', seconds },
    });
    assert.equal(task.input.seconds, seconds);
    assert.equal(harness.submittedInput().seconds, seconds);
    assert.equal(buildCangyuanVideoPayload('mu1-muse-podcast', harness.submittedInput()).duration, seconds);
    assert.equal(harness.submitCount(), 1);
  }
});

test('Cangyuan podcast rejects out-of-range durations before submission and keeps omitted duration optional', async () => {
  for (const seconds of [29, 1801]) {
    const harness = createHarness([], 'cangyuan-videos', 'mu1-muse-podcast', undefined, {}, true);
    await assert.rejects(() => harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: `invalid-podcast-duration-${seconds}`, input: { prompt: 'discuss creativity', seconds },
    }), /30–1800/);
    assert.equal(harness.task(), undefined);
    assert.equal(harness.submitCount(), 0);
  }
  const harness = createHarness([], 'cangyuan-videos', 'mu1-muse-podcast', undefined, {}, true);
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'podcast-default-duration', input: { prompt: 'discuss creativity' },
  });
  assert.equal(task.input.seconds, undefined);
  assert.equal(harness.submittedInput().seconds, undefined);
});

test('generic video submission retains the existing sixty second safety limit', async () => {
  const harness = createHarness([]);
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'generic-duration-limit', input: { prompt: 'a short video', seconds: 120 },
  });
  assert.equal(task.input.seconds, 60);
  assert.equal(harness.submittedInput().seconds, 60);
});

test('explicit Agnes and Jimeng video transports do not inherit Cangyuan validation from the provider identity', async () => {
  for (const videoTransport of ['agnes-videos', 'jimeng-cli']) {
    const harness = createHarness([], videoTransport, 'fixture-video', undefined, { platform: 'cangyuan', baseUrl: 'https://ai.cangyuansuanli.cn/v1' });
    const task = await harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: `explicit-${videoTransport}`, input: { prompt: 'use the explicitly chosen transport', seconds: 5 },
    });
    assert.equal(task.status, 'pending');
    assert.equal(harness.submitCount(), 1);
  }
});

test('a background refresh cannot submit again while initial provider submission is awaiting its response', async () => {
  const harness = createHarness([]);
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  harness.setSubmitHandler(async (_input, count) => {
    if (count === 1) {
      started.resolve();
      return response.promise;
    }
    return { providerTaskId: 'duplicate-provider-task', status: 'pending', videos: [] };
  });
  const creation = harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'initial-submission-race', input: { prompt: 'one video only' },
  });
  await started.promise;
  try {
    // A separate service instance models the Worker and HTTP route loading
    // independently; an in-memory map in just one instance is insufficient.
    await harness.loadService().refreshVideoTask('task-1');
    assert.equal(harness.submitCount(), 1);
  } finally {
    response.resolve({ providerTaskId: 'original-provider-task', status: 'pending', videos: [] });
    await creation;
  }
  assert.equal(harness.task().providerTaskId, 'original-provider-task');
});

test('retry recovers a failed task through its original provider ID without generating a second video', async () => {
  const harness = createHarness([]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'failed-status-query', input: { prompt: 'existing video' },
  });
  harness.patchTask({ status: 'failed', providerTaskId: 'original-upstream-id', error: 'Invalid URL (GET /v1/tasks/original-upstream-id)', errorCode: undefined, nextPollAt: undefined });
  harness.setPollResult({ status: 'done', providerTaskId: 'original-upstream-id', videos: [{ url: 'https://cdn.example/existing.mp4' }] });
  const task = await harness.service.retryVideoTask('task-1');
  assert.equal(task.id, 'task-1');
  assert.equal(task.status, 'done');
  assert.deepEqual(task.remoteVideoUrls, ['https://cdn.example/existing.mp4']);
  assert.equal(harness.pollCount(), 1);
  assert.equal(harness.submitCount(), 1);
});

test('batch retry refreshes existing provider tasks and blocks unconfirmed submissions', async () => {
  const harness = createHarness([]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'batch-original-video', input: { prompt: 'existing video' },
  });
  harness.patchTask({ status: 'failed', providerTaskId: 'existing-upstream-id', errorCode: undefined, nextPollAt: undefined });
  harness.setPollResult({ status: 'running', providerTaskId: 'existing-upstream-id', videos: [] });
  const task = await harness.service.retryFailedVideoTask(harness.task(), 'batch-retry-key');
  assert.equal(task.id, 'task-1');
  assert.equal(task.status, 'running');
  assert.equal(harness.submitCount(), 1);
  assert.equal(harness.pollCount(), 1);
  harness.patchTask({ status: 'failed', providerTaskId: undefined, errorCode: 'VIDEO_SUBMISSION_UNCONFIRMED' });
  await assert.rejects(() => harness.service.retryFailedVideoTask(harness.task(), 'unsafe-batch-retry'), /无法确认|未确认/);
  assert.equal(harness.submitCount(), 1);
});

test('a completed submission with a delayed output URL preserves its handle for recovery', async () => {
  const harness = createHarness([]);
  harness.setSubmitHandler(async () => ({
    status: 'done', providerTaskId: 'completed-original-id', videos: [], raw: { status: 'completed', task_id: 'completed-original-id' },
  }));
  const incomplete = await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'delayed-result-url', input: { prompt: 'existing video' },
  });
  assert.equal(incomplete.providerTaskId, 'completed-original-id');
  assert.equal(incomplete.errorCode, 'VIDEO_RESULT_MISSING');
  harness.setPollResult({ status: 'done', videos: [{ url: 'https://cdn.example/completed.mp4' }] });
  const recovered = await harness.service.retryVideoTask(incomplete.id);
  assert.equal(recovered.status, 'done');
  assert.equal(harness.submitCount(), 1);
  assert.equal(harness.pollCount(), 1);
});

test('a provider-confirmed failed video can still be generated again explicitly', async () => {
  const harness = createHarness([]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'confirmed-failure', input: { prompt: 'new attempt' },
  });
  harness.patchTask({ status: 'failed', providerTaskId: 'failed-original-id', errorCode: 'VIDEO_PROVIDER_FAILED' });
  const retried = await harness.service.retryVideoTask('task-1');
  assert.equal(retried.status, 'pending');
  assert.equal(harness.submitCount(), 2);
  assert.equal(harness.pollCount(), 0);
});

test('concurrent manual retries share one submission across service instances', async () => {
  const harness = createHarness([]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'manual-retry-source', input: { prompt: 'one retry only' },
  });
  harness.patchTask({ status: 'failed', errorCode: 'VIDEO_PROVIDER_FAILED' });
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  harness.setSubmitHandler(async () => { started.resolve(); return response.promise; });
  const first = harness.service.retryVideoTask('task-1');
  await started.promise;
  const sameService = harness.service.retryVideoTask('task-1');
  try {
    const separateService = await harness.loadService().retryVideoTask('task-1');
    assert.equal(separateService.id, 'task-2');
    assert.equal(harness.submitCount(), 2, 'one original POST and one retry POST');
  } finally {
    response.resolve({ status: 'pending', providerTaskId: 'only-retry-handle', videos: [] });
  }
  const results = await Promise.all([first, sameService]);
  assert.deepEqual(results.map((task) => task.id), ['task-2', 'task-2']);
  assert.equal(harness.task('task-1').status, 'failed');
  assert.equal(harness.task('task-2').idempotencyKey, 'manual-video-retry:task-1:1');
  assert.equal(harness.task('task-1').retryClaimedAt, undefined);
});

test('explicit manual generation remains available after completion without reviving its source', async () => {
  for (const sourceStatus of ['failed', 'cancelled', 'done']) {
    const harness = createHarness([]);
    await harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: `manual-source-${sourceStatus}`, input: { prompt: 'another explicit video' },
    });
    harness.patchTask({
      status: sourceStatus, errorCode: sourceStatus === 'failed' ? 'VIDEO_PROVIDER_FAILED' : undefined,
      ...(sourceStatus === 'done' ? { videoUrls: ['https://cdn.example/original.mp4'] } : {}),
    });
    harness.setSubmitHandler(async () => ({ status: 'done', videos: [{ url: 'https://cdn.example/new.mp4' }] }));
    const first = await harness.service.retryVideoTask('task-1');
    const second = await harness.service.retryVideoTask('task-1');
    assert.deepEqual([first.id, second.id], ['task-2', 'task-3']);
    assert.equal(harness.submitCount(), 3);
    assert.equal(harness.task('task-1').status, sourceStatus);
    assert.equal(harness.task('task-3').idempotencyKey, 'manual-video-retry:task-1:2');
  }
});

test('retrying the original video cannot bypass an unconfirmed manual retry', async () => {
  const harness = createHarness([]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'unknown-retry-source', input: { prompt: 'avoid a second charge' },
  });
  harness.patchTask({ status: 'failed', errorCode: 'VIDEO_PROVIDER_FAILED' });
  harness.pushSubmissionError(new harness.VideoProviderError('POST response lost', { possiblyAccepted: true }));
  const unconfirmed = await harness.service.retryVideoTask('task-1');
  assert.equal(unconfirmed.errorCode, 'VIDEO_SUBMISSION_UNCONFIRMED');
  const repeated = await harness.loadService().retryVideoTask('task-1');
  assert.equal(repeated.id, unconfirmed.id);
  assert.equal(repeated.errorCode, 'VIDEO_SUBMISSION_UNCONFIRMED');
  assert.equal(harness.submitCount(), 2);
});

test('refresh never revives a cancelled or genuinely failed provider task', async () => {
  for (const patch of [
    { status: 'cancelled' },
    { status: 'failed', errorCode: 'VIDEO_PROVIDER_FAILED' },
    { status: 'failed', providerResponse: { data: { status: 'failed' } } },
  ]) {
    const harness = createHarness([]);
    await harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: 'terminal-task', input: { prompt: 'terminal video' },
    });
    harness.patchTask({ providerTaskId: 'terminal-upstream-id', ...patch });
    const task = await harness.service.refreshVideoTask('task-1');
    assert.equal(task.status, patch.status);
    assert.equal(harness.pollCount(), 0);
    assert.equal(harness.submitCount(), 1);
  }
});

test('a lost POST response never causes a second charge through an automatic resubmission', async () => {
  const harness = createHarness([]);
  harness.pushSubmissionError(new harness.VideoProviderError('fetch failed', { possiblyAccepted: true }));
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'unknown-post-result', input: { prompt: 'one video only' },
  });
  assert.equal(task.status, 'failed');
  assert.equal(task.errorCode, 'VIDEO_SUBMISSION_UNCONFIRMED');
  assert.equal(harness.submitCount(), 1);
  await harness.loadService().refreshVideoTask('task-1');
  assert.equal(harness.submitCount(), 1);
});

test('Agnes Flash queue-full retries keep one task and use exponential backoff', async () => {
  const harness = createHarness([], 'agnes-videos', 'agnes-video-2.5-flash');
  const queueFull = () => new harness.VideoProviderError('video queue is full', { status: 503, code: 'AGNES_VIDEO_QUEUE_FULL' });
  const firstAttemptAt = Date.now();
  harness.pushSubmissionError(queueFull());
  const first = await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'agnes-flash-queue-full', input: { prompt: 'animate the ocean', seconds: 4, videoMode: 'text' },
  });
  assert.equal(first.status, 'pending');
  assert.equal(first.errorCode, 'VIDEO_SUBMISSION_RETRY');
  assert.equal(first.pollCount, 1);
  assert.ok(first.nextPollAt >= firstAttemptAt + 29_000);
  assert.ok(first.nextPollAt <= Date.now() + 31_000);

  harness.makeRetryEligible();
  const secondAttemptAt = Date.now();
  harness.pushSubmissionError(queueFull());
  const second = await harness.loadService().refreshVideoTask(first.id);
  assert.equal(second.status, 'pending');
  assert.equal(second.errorCode, 'VIDEO_SUBMISSION_RETRY');
  assert.equal(second.pollCount, 2);
  assert.ok(second.nextPollAt >= secondAttemptAt + 59_000);
  assert.ok(second.nextPollAt <= Date.now() + 61_000);
  assert.equal(harness.submitCount(), 2);
  assert.deepEqual(harness.submittedKeys(), ['agnes-flash-queue-full', 'agnes-flash-queue-full']);
  assert.equal(harness.task().id, first.id);
});

test('separate workers atomically claim only one retry after an explicitly rejected submission', async () => {
  const harness = createHarness([new Error('queue full')]);
  await harness.service.createVideoGeneration({
    modelId: 'model-1', idempotencyKey: 'rejected-submission-race', input: { prompt: 'one video only' },
  });
  harness.makeRetryEligible();
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  harness.setSubmitHandler(async (_input, count) => {
    if (count === 2) {
      started.resolve();
      return response.promise;
    }
    return { providerTaskId: 'duplicate-retry-task', status: 'pending', videos: [] };
  });
  const first = harness.loadService().refreshVideoTask('task-1');
  const second = harness.loadService().refreshVideoTask('task-1');
  await started.promise;
  try {
    await Promise.race([first, second]);
    assert.equal(harness.submitCount(), 2);
  } finally {
    response.resolve({ providerTaskId: 'only-retry-task', status: 'pending', videos: [] });
    await Promise.all([first, second]);
  }
  assert.equal(harness.task().providerTaskId, 'only-retry-task');
});

test('expired submission claims and legacy tasks without a task handle are never automatically resubmitted', async () => {
  for (const errorCode of ['VIDEO_SUBMISSION_IN_PROGRESS', undefined]) {
    const harness = createHarness([]);
    await harness.service.createVideoGeneration({
      modelId: 'model-1', idempotencyKey: 'orphaned-submission', input: { prompt: 'one video only' },
    });
    harness.patchTask({ errorCode, nextPollAt: Date.now() - 1 });
    const task = await harness.loadService().refreshVideoTask('task-1');
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'VIDEO_SUBMISSION_UNCONFIRMED');
    assert.equal(harness.submitCount(), 1);
  }
});

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

test('preserves an explicitly configured native-task transport', async () => {
  const harness = createHarness([], 'native-task', 'fixture-video', undefined, { platform: 'cangyuan' });
  const task = await harness.service.createVideoGeneration({
    modelId: 'model-1',
    idempotencyKey: 'explicit-native-transport',
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

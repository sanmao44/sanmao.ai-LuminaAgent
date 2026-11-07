import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

class HarnessProviderError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

function createHarness(options = {}) {
  const task = {
    id: 'upscale-task-1',
    providerTaskId: 'provider-task-1',
    provider: 'aliyun-viapi',
    model: 'aliyun-generative-super-resolution',
    scale: 2,
    sourceImageId: 'image-1',
    reference: '/stored/source.png',
    logId: 'log-1',
    status: 'processing',
    pollCount: 0,
    idempotencyKey: 'upscale-key-1',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const finishedLogs = [];
  const calls = { poll: 0, submit: 0 };
  const poll = options.poll || (async () => { throw new Error('unexpected poll'); });
  const getPublicState = options.getPublicState || (async () => ({ settings: { imageStoragePath: '' } }));
  const load = createTsRequire(process.cwd(), {
    './signed-media': { preparePublicMediaUrl: async (value) => value },
    './image-storage': {
      getDefaultStoragePath: () => '/stored',
      persistImageBuffer: async () => ({ url: '/stored/result.png', path: '/stored' }),
    },
    './store': {
      getPublicState,
      getUpscaleConnectionWithCredentials: async (provider) => ({ provider, status: 'healthy' }),
      setUpscaleConnectionStatus: async () => undefined,
    },
    './upscale-catalog': {
      getUpscaleCatalogModel: () => ({ displayName: 'Test upscale model' }),
      isUpscaleModelId: () => true,
      preferredUpscaleModelId: () => null,
    },
    './generation-log': {
      finishGenerationLog: async (...args) => { finishedLogs.push(args); },
      startGenerationLog: async () => 'log-1',
    },
    './generation-source': { normalizeGenerationSource: (_source, fallback) => fallback },
    './upscale-image': {
      ALIYUN_GENERATIVE_UPSCALE_MAX_ASPECT_RATIO: 2,
      prepareAliyunUpscaleImage: async () => ({ bytes: Buffer.from('image'), mime: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }),
      prepareTencentUpscaleImage: async () => ({ bytes: Buffer.from('image'), mime: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }),
    },
    './upscale-providers': {
      createUpscaleProvider: () => ({
        poll: async (...args) => { calls.poll += 1; return poll(...args); },
        upscale: async () => { calls.submit += 1; throw new Error('unexpected submit'); },
      }),
      isUpscaleProviderError: (error) => error instanceof HarnessProviderError,
      uploadAliyunImageToOss: async () => 'https://upload.example/image.png',
      uploadTencentImageToCos: async () => 'https://upload.example/image.png',
    },
    './upscale-task-store': {
      UPSCALE_TASK_TIMEOUT_MS: 20 * 60_000,
      createUpscaleTask: async () => { throw new Error('unexpected task creation'); },
      findUpscaleTask: async (id) => id === task.id ? task : null,
      updateUpscaleTask: async (id, patch) => {
        if (id !== task.id) return null;
        Object.assign(task, patch);
        return task;
      },
    },
    './upscale-task-runtime': { canRetryUpscaleTask: () => false, upscaleTaskRuntime: { isActive: (status) => status === 'queued' || status === 'processing' } },
    './upscale-task-output': { upscaleTaskOutputUrl: () => '', upscaleTaskStatus: (value) => value.status },
  });
  return { task, finishedLogs, calls, service: load('./lib/upscale-service') };
}

test('transient poll failures keep the upstream task and schedule a bounded retry without resubmission', async () => {
  const cases = [
    { failure: new HarnessProviderError('The provider is rate limited', 'UPSTREAM_ERROR', { status: 429, retryAfterMs: 5000 }), delayMs: 5000 },
    { failure: new HarnessProviderError('Provider temporarily unavailable', 'UPSTREAM_ERROR', { status: 503 }) },
    { failure: new TypeError('fetch failed') },
  ];

  for (const { failure, delayMs } of cases) {
    const harness = createHarness({ poll: async () => { throw failure; } });
    const startedAt = Date.now();

    const updated = await harness.service.refreshUpscaleTask(harness.task.id);

    assert.equal(updated.status, 'processing');
    assert.equal(updated.providerTaskId, 'provider-task-1');
    assert.equal(updated.pollCount, 1);
    assert.ok(updated.nextPollAt > startedAt);
    assert.ok(updated.nextPollAt <= startedAt + 15 * 60_000);
    if (delayMs !== undefined) assert.ok(Math.abs(updated.nextPollAt - startedAt - delayMs) < 100);
    assert.equal(updated.errorCode, 'POLL_RETRY');
    assert.match(updated.error, /自動|自动/);
    assert.equal(harness.calls.poll, 1);
    assert.equal(harness.calls.submit, 0);
    assert.equal(harness.finishedLogs.length, 0);
  }
});

test('a retried provider poll can complete and archive the original task', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    let attempts = 0;
    const harness = createHarness({
      poll: async () => {
        attempts += 1;
        if (attempts === 1) throw new HarnessProviderError('temporary limit', 'UPSTREAM_ERROR', { status: 429, retryAfterMs: 1000 });
        return { status: 'succeeded', provider: 'aliyun-viapi', model: 'aliyun-generative-super-resolution', buffer: Buffer.from('result'), mime: 'image/png' };
      },
    });

    await harness.service.refreshUpscaleTask(harness.task.id);
    now = harness.task.nextPollAt;
    const updated = await harness.service.refreshUpscaleTask(harness.task.id);

    assert.equal(updated.status, 'succeeded');
    assert.equal(updated.providerTaskId, 'provider-task-1');
    assert.equal(updated.pollCount, 1);
    assert.equal(updated.error, undefined);
    assert.equal(harness.calls.poll, 2);
    assert.equal(harness.calls.submit, 0);
    assert.equal(harness.finishedLogs.length, 1);
    assert.equal(harness.finishedLogs[0][1].status, 'success');
  } finally {
    Date.now = originalNow;
  }
});

test('permanent provider errors still fail and finish the generation log', async () => {
  const harness = createHarness({
    poll: async () => { throw new HarnessProviderError('Check provider credentials', 'INVALID_CREDENTIAL', { status: 401 }); },
  });

  const updated = await harness.service.refreshUpscaleTask(harness.task.id);

  assert.equal(updated.status, 'failed');
  assert.equal(updated.providerTaskId, 'provider-task-1');
  assert.equal(updated.pollCount, 0);
  assert.equal(updated.errorCode, 'INVALID_CREDENTIAL');
  assert.equal(harness.finishedLogs.length, 1);
  assert.equal(harness.finishedLogs[0][1].status, 'error');
  assert.equal(harness.calls.submit, 0);
});

test('result persistence failures are not treated as transient provider poll failures', async () => {
  const harness = createHarness({
    getPublicState: async () => { throw new Error('local storage unavailable'); },
    poll: async () => ({ status: 'succeeded', provider: 'aliyun-viapi', model: 'aliyun-generative-super-resolution', buffer: Buffer.from('result'), mime: 'image/png' }),
  });

  const updated = await harness.service.refreshUpscaleTask(harness.task.id);

  assert.equal(updated.status, 'failed');
  assert.equal(updated.error, 'local storage unavailable');
  assert.equal(updated.pollCount, 0);
  assert.equal(updated.nextPollAt, undefined);
  assert.equal(harness.finishedLogs.length, 1);
  assert.equal(harness.calls.poll, 1);
  assert.equal(harness.calls.submit, 0);
});

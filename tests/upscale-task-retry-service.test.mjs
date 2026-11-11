import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

class HarnessProviderError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function createHarness({ providerError, preflightError, providerResult } = {}) {
  const calls = [];
  const logs = [];
  const tasks = new Map();
  const parent = {
    id: 'source-task',
    provider: 'aliyun-viapi',
    model: 'aliyun-generative-super-resolution',
    scale: 2,
    sourceImageId: 'source-image',
    reference: '/stored/source.png',
    status: 'failed',
    errorCode: 'INVALID_IMAGE',
    retryDisposition: 'explicit_rejection',
    idempotencyKey: 'source-key',
    logId: 'source-log',
    createdAt: new Date().toISOString(),
  };
  tasks.set(parent.id, parent);
  let nextTaskId = 0;
  const service = createTsRequire(process.cwd(), {
    './signed-media': { preparePublicMediaUrl: async (value) => value },
    './image-storage': {
      getDefaultStoragePath: () => '/stored',
      persistImageBuffer: async () => ({ url: '/stored/result.png', path: '/stored' }),
    },
    './store': {
      getPublicState: async () => ({
        settings: { imageStoragePath: '/stored' },
        upscaleConnections: [{ provider: 'aliyun-viapi', connected: true }],
      }),
      getUpscaleConnectionWithCredentials: async (provider) => ({
        provider,
        status: 'healthy',
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret',
      }),
      setUpscaleConnectionStatus: async (...args) => calls.push(['connection-status', ...args]),
    },
    './upscale-catalog': {
      getUpscaleCatalogModel: () => ({
        id: 'aliyun-generative-super-resolution',
        provider: 'aliyun-viapi',
        displayName: 'Test upscale model',
        scales: [2],
        outputFormats: ['png'],
      }),
      isUpscaleModelId: () => true,
      preferredUpscaleModelId: () => null,
    },
    './generation-log': {
      finishGenerationLog: async (...args) => logs.push(['finish', ...args]),
      startGenerationLog: async (input, requestedId) => {
        logs.push(['start', input, requestedId]);
        return requestedId || `log-${logs.length}`;
      },
    },
    './generation-source': { normalizeGenerationSource: (_source, fallback) => fallback },
    './upscale-image': {
      ALIYUN_GENERATIVE_UPSCALE_MAX_ASPECT_RATIO: 2,
      prepareAliyunUpscaleImage: async () => {
        if (preflightError) throw preflightError;
        return { bytes: Buffer.from('image'), mime: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' };
      },
      prepareTencentUpscaleImage: async () => ({ bytes: Buffer.from('image'), mime: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }),
    },
    './upscale-providers': {
      createUpscaleProvider: () => ({
        upscale: async () => {
          calls.push(['provider-submit']);
          if (providerError) throw providerError;
          return providerResult || { status: 'processing', provider: 'aliyun-viapi', model: 'aliyun-generative-super-resolution', providerTaskId: 'provider-task-1' };
        },
      }),
      isUpscaleProviderError: (error) => error instanceof HarnessProviderError,
      uploadAliyunImageToOss: async () => 'https://upload.example/source.png',
      uploadTencentImageToCos: async () => 'https://upload.example/source.png',
    },
    './upscale-task-store': {
      UPSCALE_TASK_TIMEOUT_MS: 20 * 60_000,
      createUpscaleTask: async (input) => {
        calls.push(['create', input]);
        const task = { ...input, id: `child-${++nextTaskId}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pollCount: 0 };
        tasks.set(task.id, task);
        return { task, created: true };
      },
      findUpscaleTask: async (id) => tasks.get(id) || null,
      updateUpscaleTask: async (id, patch) => {
        calls.push(['update', id, patch]);
        const task = tasks.get(id);
        if (!task) return null;
        Object.assign(task, patch);
        return task;
      },
    },
    './upscale-task-runtime': {
      canRetryUpscaleTask: () => true,
      upscaleTaskRuntime: { isActive: (status) => status === 'queued' || status === 'processing' },
    },
    './upscale-task-output': { upscaleTaskOutputUrl: () => '', upscaleTaskStatus: (task) => task.status },
  })('./lib/upscale-service');
  return { calls, logs, parent, tasks, service };
}

test('only explicit provider rejection after submission is marked safe for batch retry', async () => {
  const explicit = createHarness({ providerError: new HarnessProviderError('Request rejected', 'INVALID_CREDENTIAL') });
  await assert.rejects(explicit.service.startCloudUpscale({
    reference: '/stored/image.png',
    requestedModel: 'aliyun-generative-super-resolution',
    scale: 2,
    logId: 'explicit-log',
  }));
  const explicitTask = [...explicit.tasks.values()].find((task) => task.id !== explicit.parent.id);
  assert.equal(explicitTask.retryDisposition, 'explicit_rejection');
  assert.equal(explicitTask.taskId, undefined);
  assert.equal(explicit.logs.find(([kind]) => kind === 'finish')[2].retryDisposition, 'explicit_rejection');
  assert.equal(explicit.logs.find(([kind]) => kind === 'finish')[2].taskId, explicitTask.id);

  const ambiguous = createHarness({ providerError: new HarnessProviderError('Response lost', 'UPSTREAM_ERROR') });
  await assert.rejects(ambiguous.service.startCloudUpscale({
    reference: '/stored/image.png',
    requestedModel: 'aliyun-generative-super-resolution',
    scale: 2,
  }));
  const ambiguousTask = [...ambiguous.tasks.values()].find((task) => task.id !== ambiguous.parent.id);
  assert.equal(ambiguousTask.retryDisposition, 'unknown');
  assert.equal(ambiguous.calls.filter(([kind]) => kind === 'provider-submit').length, 1);
});

test('preflight failure is not mislabeled as provider rejection', async () => {
  const harness = createHarness({ preflightError: new HarnessProviderError('Invalid source dimensions', 'INVALID_IMAGE') });
  await assert.rejects(harness.service.startCloudUpscale({
    reference: '/stored/image.png',
    requestedModel: 'aliyun-generative-super-resolution',
    scale: 2,
  }));
  const task = [...harness.tasks.values()].find((item) => item.id !== harness.parent.id);
  assert.equal(task.retryDisposition, 'unknown');
  assert.equal(harness.calls.some(([kind]) => kind === 'provider-submit'), false);
});

test('batch and legacy manual retries persist retryOf before submitting the child task', async () => {
  const harness = createHarness();
  const batchChild = await harness.service.retryFailedUpscaleTask(harness.parent, 'stable-batch-key');
  const batchCreateIndex = harness.calls.findIndex(([kind, input]) => kind === 'create' && input.idempotencyKey === 'stable-batch-key');
  const batchSubmitIndex = harness.calls.findIndex(([kind], index) => kind === 'provider-submit' && index > batchCreateIndex);
  const batchInput = harness.calls[batchCreateIndex][1];
  assert.equal(batchInput.retryOf, harness.parent.id);
  assert.equal(batchChild.retryOf, harness.parent.id);
  assert.ok(batchCreateIndex < batchSubmitIndex);
  assert.equal(harness.parent.retryDisposition, 'blocked');

  const completed = { ...harness.parent, id: 'completed-task', status: 'succeeded', errorCode: undefined, retryDisposition: undefined };
  harness.tasks.set(completed.id, completed);
  const manualChild = await harness.service.retryUpscaleTask(completed.id);
  assert.equal(manualChild.retryOf, completed.id);
  assert.equal(manualChild.status, 'processing');
});

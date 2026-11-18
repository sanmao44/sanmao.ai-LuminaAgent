import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const providerAdapter = load('./lib/cangyuan-media-provider');
const serviceModule = createTsRequire(process.cwd(), {
  './cangyuan-provider': load('./lib/cangyuan-provider'),
  './providers': { authHeaders: () => ({}), runtimeBaseUrl: (provider) => provider.baseUrl },
  './store': { getProviderWithKey: async () => null, getRuntimeModel: async () => null },
  './cangyuan-media-task-store': { cangyuanCreativeTaskRepository: createMemoryRepository() },
  './cangyuan-media-provider': providerAdapter,
})('./lib/cangyuan-media-task-service');

function createMemoryRepository() {
  const records = [];
  let mutation = Promise.resolve();
  const mutate = (fn) => {
    const operation = mutation.then(() => fn(records));
    mutation = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return {
    records,
    async find(id) { return records.find((task) => task.id === id) || null; },
    async findByIdempotencyKey(key) { return records.find((task) => task.idempotencyKey === key) || null; },
    async list(limit = 100) { return records.slice(0, limit); },
    async page({ page = 1, pageSize = 12, maxPageSize = 100, matches, compare } = {}) {
      const size = Math.min(maxPageSize, Math.max(1, Math.round(pageSize)));
      const filtered = records.filter((task) => !matches || matches(task));
      if (compare) filtered.sort(compare);
      const totalPages = Math.max(1, Math.ceil(filtered.length / size));
      const currentPage = Math.min(Math.max(1, Math.round(page)), totalPages);
      return {
        tasks: filtered.slice((currentPage - 1) * size, currentPage * size),
        total: filtered.length,
        page: currentPage,
        pageSize: size,
        totalPages,
      };
    },
    insert(task) {
      return mutate((tasks) => {
        const existing = tasks.find((item) => item.idempotencyKey === task.idempotencyKey);
        if (existing) return { task: existing, created: false };
        tasks.unshift(task);
        return { task, created: true };
      });
    },
    mutate,
  };
}

function createHarness(overrides = {}) {
  const repository = createMemoryRepository();
  const providerConfig = {
    type: 'openai-compatible',
    ...overrides.providerConfig,
    ...(overrides.providerConfig ? {} : {
    id: 'provider-1',
    platform: 'cangyuan',
    creativeTaskProtocol: 'cangyuan-creative-v1',
    baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
    apiKey: 'test-key',
    }),
  };
  const runtime = overrides.runtime ? {
    ...overrides.runtime,
    provider: {
      type: 'openai-compatible',
      ...overrides.runtime.provider,
      ...(overrides.runtime.provider.platform === 'cangyuan'
        ? { creativeTaskProtocol: 'cangyuan-creative-v1' }
        : {}),
    },
  } : {
    provider: providerConfig,
    model: { id: 'model-1', rawId: 'su2-suno-v6', displayName: 'Suno v6', capabilities: ['music-generate', '3d-generate'] },
  };
  let currentTime = 1_000_000;
  let idSequence = 0;
  const submitted = [];
  const polled = [];
  const resolvedKinds = [];
  let submit = overrides.submit || (async (_client, kind, model, input) => {
    submitted.push({ kind, model, input });
    return { id: 'remote-task-1', status: 'pending', outputs: [] };
  });
  let poll = overrides.poll || (async (_client, kind, id) => {
    polled.push({ kind, id });
    return { id, status: 'running', providerStatus: 'in_progress', outputs: [] };
  });

  const service = serviceModule.createCangyuanMediaTaskService({
    repository,
    resolveModel: async (modelId, kind) => {
      resolvedKinds.push({ modelId, kind });
      if (overrides.resolveModel) return overrides.resolveModel(modelId, kind, runtime);
      if (kind === '3d' && !overrides.runtime) return { ...runtime, model: { ...runtime.model, rawId: 'tripo3d', displayName: 'Tripo3D' } };
      return runtime;
    },
    resolveProvider: async () => overrides.resolveProvider ? overrides.resolveProvider(providerConfig) : providerConfig,
    createClient: (provider) => ({ baseUrl: provider.baseUrl, headers: { Authorization: 'Bearer test-key' } }),
    provider: {
      buildThreeDPayload: providerAdapter.buildCangyuanThreeDPayload,
      submit: (...args) => submit(...args),
      poll: (...args) => poll(...args),
      isRetryable: providerAdapter.isRetryableCangyuanProviderError,
    },
    now: () => currentTime,
    newId: () => `local-${++idSequence}`,
  });

  return {
    service,
    repository,
    submitted,
    polled,
    resolvedKinds,
    setTime(value) { currentTime = value; },
    setSubmit(value) { submit = value; },
    setPoll(value) { poll = value; },
  };
}

test('service requires the declared creative task protocol and matching model capabilities', async () => {
  const harness = createHarness({ resolveModel: (_id, kind, runtime) => kind === 'audio' ? runtime : null });
  const music = await harness.service.create({ kind: 'music', modelId: 'model-1', idempotencyKey: 'music-1', input: { prompt: 'ambient synth' } });
  assert.equal(music.kind, 'music');
  assert.deepEqual(harness.resolvedKinds[0], { modelId: 'model-1', kind: 'audio' });
  await assert.rejects(
    harness.service.create({ kind: '3d', modelId: 'model-1', idempotencyKey: '3d-1', input: { prompt: 'wooden boat' } }),
    /请选择已启用的音乐或三维模型/,
  );

  const otherProvider = createHarness({ runtime: {
    provider: { id: 'provider-other', platform: 'custom', baseUrl: 'https://provider.example.test', apiKey: 'key' },
    model: { id: 'image-model', rawId: 'image-model', displayName: 'Image model' },
  } });
  await assert.rejects(
    otherProvider.service.create({ kind: 'music', modelId: 'image-model', idempotencyKey: 'wrong-provider', input: { prompt: 'ambient synth' } }),
    /请为服务商启用音乐与三维任务接口/,
  );
  assert.equal(otherProvider.repository.records.length, 0);

  const optedInProvider = createHarness({ runtime: {
    provider: { id: 'provider-opted-in', platform: 'custom', creativeTaskProtocol: 'cangyuan-creative-v1', baseUrl: 'https://provider.example.test', apiKey: 'key' },
    model: { id: 'music-model', rawId: 'su2-suno-v6', displayName: 'Music model', capabilities: ['music-generate'] },
  } });
  const genericMusic = await optedInProvider.service.create({ kind: 'music', modelId: 'music-model', idempotencyKey: 'generic-music', input: { prompt: 'ambient synth' } });
  assert.equal(genericMusic.kind, 'music');
  assert.equal(genericMusic.providerId, 'provider-opted-in');

  const missingCapability = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'audio-only', rawId: 'audio-only', displayName: 'Audio only', capabilities: ['music-generate'] },
  } });
  await assert.rejects(
    missingCapability.service.create({ kind: '3d', modelId: 'audio-only', idempotencyKey: 'missing-capability', input: { prompt: 'wooden boat' } }),
    /不支持三维生成能力/,
  );
  assert.equal(missingCapability.repository.records.length, 0);
});

test('accepts a saved generic provider with the official Cangyuan API hostname', async () => {
  const harness = createHarness({ providerConfig: {
    id: 'legacy-cangyuan',
    platform: 'custom',
    creativeTaskProtocol: 'cangyuan-creative-v1',
    baseUrl: 'https://ai.cangyuansuanli.cn/v1',
    apiKey: 'test-key',
  } });
  const task = await harness.service.create({
    kind: 'music', modelId: 'model-1', idempotencyKey: 'legacy-cangyuan-music', input: { prompt: 'ambient synth' },
  });
  assert.equal(task.providerId, 'legacy-cangyuan');
  assert.equal(harness.submitted.length, 1);
});

test('music service only accepts exact documented model ids and stores validated Suno v6 options', async () => {
  const unsupported = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'derived', rawId: 'suno-v6.1', displayName: 'Suno v6.1', capabilities: ['music-generate'] },
  } });
  await assert.rejects(
    unsupported.service.create({ kind: 'music', modelId: 'derived', idempotencyKey: 'unsupported-music', input: { prompt: 'ambient synth' } }),
    /模型尚未接入/,
  );
  assert.equal(unsupported.repository.records.length, 0);
  assert.equal(unsupported.submitted.length, 0);

  const sunoV6 = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'suno-v6', rawId: 'suno-v6', displayName: 'Suno v6', capabilities: ['music-generate'] },
  } });
  const input = {
    prompt: 'ambient synth', title: 'Night Drive', style_text: 'dream pop', instrumental: false,
    duration: 180, n: 1, audioWeight: 0.4, negativeTags: 'metal', personaId: 'persona-1',
    personaModel: 'future-compatible-model', styleWeight: 0.7, version: 'v6-mini', vocalGender: 'f',
    weirdnessConstraint: 0.2,
  };
  const task = await sunoV6.service.create({ kind: 'music', modelId: 'suno-v6', idempotencyKey: 'full-contract', input });
  assert.deepEqual(task.input, input);
  assert.equal(sunoV6.submitted.length, 1);
  await assert.rejects(
    sunoV6.service.create({ kind: 'music', modelId: 'suno-v6', idempotencyKey: 'undocumented-source', input: { prompt: 'song', sourceTaskId: 'job-1' } }),
    /不支持这些音乐参数/,
  );
});

test('music service rejects out-of-range and model-incompatible options before persistence', async () => {
  const su2 = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'su2', rawId: 'su2-suno-v6-wild', displayName: 'Suno v6 Wild', capabilities: ['music-generate'] },
  } });
  await assert.rejects(
    su2.service.create({ kind: 'music', modelId: 'su2', idempotencyKey: 'too-long', input: { prompt: 'x'.repeat(3001) } }),
    /1–3000/,
  );
  await assert.rejects(
    su2.service.create({ kind: 'music', modelId: 'su2', idempotencyKey: 'unsupported-option', input: { prompt: 'song', styleWeight: 0.5 } }),
    /不支持这些音乐参数/,
  );
  assert.equal(su2.repository.records.length, 0);
  assert.equal(su2.submitted.length, 0);
});

test('submission stores completed outputs and polling persists later provider results', async () => {
  const immediate = createHarness({ submit: async () => ({
    status: 'succeeded',
    providerStatus: 'completed',
    outputs: [{ url: 'https://cdn.example.test/song.mp3', jobId: 'job-1', audioId: 'audio-1' }],
  }) });
  const completed = await immediate.service.create({ kind: 'music', modelId: 'model-1', idempotencyKey: 'finished', input: { prompt: 'ambient synth' } });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.outputs, [{ url: 'https://cdn.example.test/song.mp3', jobId: 'job-1', audioId: 'audio-1' }]);
  assert.equal((await immediate.service.list('music'))[0].id, completed.id);

  const later = createHarness({ poll: async (_client, _kind, id) => ({
    id,
    status: 'succeeded',
    providerStatus: 'completed',
    outputs: [{ url: 'https://cdn.example.test/model.glb' }],
  }) });
  const created = await later.service.create({ kind: '3d', modelId: 'model-1', idempotencyKey: 'later', input: { prompt: 'wooden boat', mode: 'text-to-3d' } });
  later.setTime(created.nextPollAt);
  const refreshed = await later.service.get(created.id);
  assert.equal(refreshed.status, 'succeeded');
  assert.deepEqual(refreshed.outputs, [{ url: 'https://cdn.example.test/model.glb', artifactType: 'glb' }]);
  assert.equal(later.repository.records[0].status, 'succeeded');
});

test('task history filters by media kind before applying its result limit', async () => {
  const harness = createHarness();
  harness.repository.records.push(
    { id: 'new-music-1', kind: 'music', createdAt: '2026-11-18T12:03:00.000Z' },
    { id: 'new-music-2', kind: 'music', createdAt: '2026-11-18T12:02:00.000Z' },
    { id: 'older-3d-1', kind: '3d', createdAt: '2026-11-18T12:01:00.000Z' },
    { id: 'older-3d-2', kind: '3d', createdAt: '2026-11-18T12:00:00.000Z' },
  );

  assert.deepEqual((await harness.service.list('3d', 1)).map((task) => task.id), ['older-3d-1']);
  assert.deepEqual((await harness.service.list('3d', 2)).map((task) => task.id), ['older-3d-1', 'older-3d-2']);
});

test('completed text artifacts are accepted without a media URL', async () => {
  const harness = createHarness({ submit: async () => ({
    status: 'succeeded', providerStatus: 'completed', outputs: [{ text: 'structured lyrics', artifactType: 'text' }],
  }) });
  const task = await harness.service.create({ kind: 'music', modelId: 'model-1', idempotencyKey: 'text-artifact', input: { prompt: 'write lyrics' } });
  assert.equal(task.status, 'succeeded');
  assert.deepEqual(task.outputs, [{ text: 'structured lyrics', artifactType: 'text' }]);
});

test('temporary poll failures retain the active task and schedule bounded backoff', async () => {
  const harness = createHarness({ poll: async () => {
    const error = new Error('upstream unavailable');
    error.status = 503;
    throw error;
  } });
  const task = await harness.service.create({ kind: '3d', modelId: 'model-1', idempotencyKey: 'retry', input: { prompt: 'wooden boat', mode: 'text-to-3d' } });
  const firstPollAt = task.nextPollAt;
  harness.setTime(firstPollAt);
  const afterError = await harness.service.get(task.id);
  assert.equal(afterError.status, 'pending');
  assert.equal(afterError.pollCount, 1);
  assert.equal(afterError.nextPollAt, firstPollAt + 3_000);
  assert.equal(afterError.error, undefined);
});

test('late provider completion cannot overwrite a concurrently cancelled task', async () => {
  let resolvePoll;
  const harness = createHarness({ poll: () => new Promise((resolve) => { resolvePoll = resolve; }) });
  const task = await harness.service.create({ kind: '3d', modelId: 'model-1', idempotencyKey: 'terminal', input: { prompt: 'wooden boat', mode: 'text-to-3d' } });
  harness.setTime(task.nextPollAt);
  const refresh = harness.service.get(task.id);
  await new Promise((resolve) => setImmediate(resolve));
  await harness.repository.mutate((tasks) => { tasks[0].status = 'cancelled'; });
  resolvePoll({ id: 'remote-task-1', status: 'succeeded', outputs: [{ url: 'https://cdn.example.test/model.glb' }] });
  const result = await refresh;
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.outputs, []);
});

test('concurrent requests with one idempotency key create and submit only one task', async () => {
  let submitCount = 0;
  const harness = createHarness({ submit: async () => {
    submitCount += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return { id: 'remote-task-1', status: 'pending', outputs: [] };
  } });
  const options = { kind: 'music', modelId: 'model-1', idempotencyKey: 'same-request', input: { prompt: 'ambient synth' } };
  const tasks = await Promise.all([harness.service.create(options), harness.service.create(options)]);
  assert.equal(submitCount, 1);
  assert.equal(harness.repository.records.length, 1);
  assert.equal(tasks[0].id, tasks[1].id);
});

test('3D model-specific parameters are whitelisted before task persistence', async () => {
  const tripo = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'model-1', rawId: 'tripo3d', displayName: 'Tripo3D', capabilities: ['3d-generate'] },
  } });
  const task = await tripo.service.create({
    kind: '3d', modelId: 'model-1', idempotencyKey: 'tripo-image',
    input: { prompt: 'wooden boat', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png', texture: 'HD', pbr: true },
  });
  assert.equal(task.status, 'pending');
  assert.equal(tripo.submitted[0].input.imageUrl, 'https://cdn.example.test/boat.png');

  const unsupported = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'generic-3d', rawId: 'generic-3d', displayName: 'Generic 3D', capabilities: ['3d-generate'] },
  } });
  await assert.rejects(
    unsupported.service.create({ kind: '3d', modelId: 'generic-3d', idempotencyKey: 'unsupported', input: { prompt: 'wooden boat', texture: 'HD' } }),
    /模型尚未接入/,
  );
  assert.equal(unsupported.repository.records.length, 0);
});

test('Tripo tasks preserve multiview inputs and expose FBX outputs for quad mode', async () => {
  const p2 = createHarness({
    runtime: {
      provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
      model: { id: 'p2-model', rawId: 'tripo3d-p2', displayName: 'Tripo3D P2', capabilities: ['3d-generate'] },
    },
    submit: async () => ({ id: 'remote-p2', status: 'succeeded', outputs: [{ url: 'https://cdn.example.test/model.fbx' }] }),
  });
  const task = await p2.service.create({
    kind: '3d', modelId: 'p2-model', idempotencyKey: 'p2-quad',
    input: { prompt: 'A carved boat', mode: 'text-to-3d', quad: true, faceLimit: 25_000 },
  });
  assert.equal(task.status, 'succeeded');
  assert.deepEqual(task.outputs, [{ url: 'https://cdn.example.test/model.fbx', artifactType: 'fbx' }]);

  const multiview = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'p1-model', rawId: 'tripo3d-p1', displayName: 'Tripo3D P1', capabilities: ['3d-generate'] },
  } });
  const multiviewTask = await multiview.service.create({
    kind: '3d', modelId: 'p1-model', idempotencyKey: 'p1-multiview',
    input: { mode: 'multiview-to-3d', multiviewImages: { front: 'https://cdn.example.test/front.png', right: 'https://cdn.example.test/right.png' } },
  });
  assert.equal(multiviewTask.input.multiviewImages.front, 'https://cdn.example.test/front.png');
  assert.equal(multiviewTask.outputs.length, 0);
});

test('invalid Tripo constraints fail before task persistence', async () => {
  const p1 = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'p1-model', rawId: 'tripo3d-p1', displayName: 'Tripo3D P1', capabilities: ['3d-generate'] },
  } });
  await assert.rejects(p1.service.create({
    kind: '3d', modelId: 'p1-model', idempotencyKey: 'p1-invalid',
    input: { mode: 'multiview-to-3d', multiviewImages: { back: 'https://cdn.example.test/back.png', left: 'https://cdn.example.test/left.png' } },
  }), /必须包含正面 front/);
  assert.equal(p1.repository.records.length, 0);
  assert.equal(p1.submitted.length, 0);
});

test('Trellis task service retains every documented option and allows image-only input', async () => {
  const trellis = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'trellis-model', rawId: 'trellis', displayName: 'Trellis', capabilities: ['3d-generate'] },
  } });
  const input = {
    prompt: '', imageUrl: 'https://cdn.example.test/object.png', textureSize: '3072', seed: '7',
    meshSimplify: 0.96, ssGuidanceStrength: 4.5, ssSamplingSteps: 30,
    slatGuidanceStrength: 6, slatSamplingSteps: 24,
  };
  const task = await trellis.service.create({ kind: '3d', modelId: 'trellis-model', idempotencyKey: 'trellis-image', input });
  assert.deepEqual(task.input, input);
  assert.deepEqual(trellis.submitted[0].input, input);
  assert.equal(task.nextPollAt - Date.parse(task.createdAt), 3_000);
  assert.equal(trellis.repository.records.length, 1);
});

test('Trellis requires an externally reachable image and rejects undocumented models before persistence', async () => {
  const trellis = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'trellis-model', rawId: 'trellis', displayName: 'Trellis', capabilities: ['3d-generate'] },
  } });
  await assert.rejects(
    trellis.service.create({ kind: '3d', modelId: 'trellis-model', idempotencyKey: 'missing-image', input: { prompt: '' } }),
    /公网图片地址/,
  );
  assert.equal(trellis.repository.records.length, 0);
  assert.equal(trellis.submitted.length, 0);

  const generic = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'generic-3d', rawId: 'generic-3d', displayName: 'Generic 3D', capabilities: ['3d-generate'] },
  } });
  await assert.rejects(
    generic.service.create({ kind: '3d', modelId: 'generic-3d', idempotencyKey: 'generic', input: { prompt: 'object' } }),
    /模型尚未接入/,
  );
  assert.equal(generic.repository.records.length, 0);
  assert.equal(generic.submitted.length, 0);
});

test('Trellis rejects non-string or empty seeds before task persistence', async () => {
  for (const [idempotencyKey, seed] of [['trellis-number-seed', 7], ['trellis-empty-seed', '']]) {
    const trellis = createHarness({ runtime: {
      provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
      model: { id: 'trellis-model', rawId: 'trellis', displayName: 'Trellis', capabilities: ['3d-generate'] },
    } });
    await assert.rejects(
      trellis.service.create({ kind: '3d', modelId: 'trellis-model', idempotencyKey, input: { prompt: '', imageUrl: 'https://cdn.example.test/object.png', seed } }),
      /seed 必须是非空字符串/,
    );
    assert.equal(trellis.repository.records.length, 0);
    assert.equal(trellis.submitted.length, 0);
  }
});

test('Tripo3D default image mode refuses a missing public image before task persistence', async () => {
  const tripo = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'tripo-model', rawId: 'tripo3d', displayName: 'Tripo3D', capabilities: ['3d-generate'] },
  } });

  await assert.rejects(
    tripo.service.create({ kind: '3d', modelId: 'tripo-model', idempotencyKey: 'tripo-default-mode', input: { prompt: 'wooden boat' } }),
    /必须提供公网图片地址/,
  );
  assert.equal(tripo.repository.records.length, 0);
  assert.equal(tripo.submitted.length, 0);
});

test('Tripo3D text mode requires a prompt before task persistence', async () => {
  const tripo = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'tripo-model', rawId: 'tripo3d', displayName: 'Tripo3D', capabilities: ['3d-generate'] },
  } });

  await assert.rejects(
    tripo.service.create({ kind: '3d', modelId: 'tripo-model', idempotencyKey: 'tripo-empty-prompt', input: { prompt: '', mode: 'text-to-3d' } }),
    /必须提供物体描述/,
  );
  assert.equal(tripo.repository.records.length, 0);
  assert.equal(tripo.submitted.length, 0);
});

test('Tripo3D image mode requires both a prompt and a public image', async () => {
  const tripo = createHarness({ runtime: {
    provider: { id: 'provider-1', platform: 'cangyuan', baseUrl: 'https://direct-api.cangyuansuanli.cn/v1', apiKey: 'test-key' },
    model: { id: 'tripo-model', rawId: 'tripo3d', displayName: 'Tripo3D', capabilities: ['3d-generate'] },
  } });

  await assert.rejects(
    tripo.service.create({ kind: '3d', modelId: 'tripo-model', idempotencyKey: 'tripo-image-no-prompt', input: { prompt: '', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png' } }),
    /必须提供物体描述/,
  );
  assert.equal(tripo.repository.records.length, 0);
  assert.equal(tripo.submitted.length, 0);

  await assert.rejects(
    tripo.service.create({ kind: '3d', modelId: 'tripo-model', idempotencyKey: 'tripo-image-no-url', input: { prompt: 'A carved wooden boat', mode: 'image-to-3d' } }),
    /必须提供公网图片地址/,
  );
  assert.equal(tripo.repository.records.length, 0);
  assert.equal(tripo.submitted.length, 0);

  const task = await tripo.service.create({
    kind: '3d', modelId: 'tripo-model', idempotencyKey: 'tripo-image-with-prompt',
    input: { prompt: 'A carved wooden boat', mode: 'image-to-3d', imageUrl: 'https://cdn.example.test/boat.png' },
  });
  assert.equal(task.status, 'pending');
  assert.equal(tripo.submitted.length, 1);
  assert.equal(tripo.submitted[0].input.prompt, 'A carved wooden boat');
  assert.equal(tripo.submitted[0].input.imageUrl, 'https://cdn.example.test/boat.png');
});

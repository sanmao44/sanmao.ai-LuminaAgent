import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

async function compileTypeScript(path, transform = (source) => source) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = transform(await readFile(sourceUrl, 'utf8'));
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
}

const localEditRuntime = (await compileTypeScript('../lib/local-edit.ts'))
  .replace(/\bexport\s+/g, '');
const videoContractRuntime = (await compileTypeScript('../packages/contracts/video-generation.ts'))
  .replace(/\bexport\s+/g, '');
const sourceUrl = new URL('../lib/creation/settings.ts', import.meta.url);
const compiled = await compileTypeScript('../lib/creation/settings.ts', (source) => source
  .replace(
    /^import\s+\{\s*parseVideoModelParameterValues,\s*type\s+VideoModelParameterValues\s*\}\s+from\s+["']@\/packages\/contracts\/video-generation["'];?\s*$/m,
    videoContractRuntime,
  )
  .replace(
    /^import\s+\{\s*normalizeLocalEditAnnotations\s*,\s*type\s+LocalEditAnnotation\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m,
    localEditRuntime,
  )
  .replace(
    /^import\s+\{\s*getCangyuanImageModelProfile\s*\}\s+from\s+["']\.\.\/cangyuan-image-capabilities["'];?\s*$/m,
    'const getCangyuanImageModelProfile = () => null;',
  )
  .replace(
    /^import\s+\{[^}]*\}\s+from\s+["']\.\.\/cangyuan-video-capabilities["'];?\s*$/m,
    'const getCangyuanVideoModelProfile = () => null; const isCangyuanVideoModelSelectable = () => false;',
  )
  .replace(
    /^import\s+\{\s*getCangyuanVideoModelSpec\s*,\s*getCangyuanVideoParameter\s*\}\s+from\s+["']\.\.\/cangyuan-video-model-catalog["'];?\s*$/m,
    'const getCangyuanVideoModelSpec = () => null; const getCangyuanVideoParameter = () => undefined;',
  )
  .replace(
    /^import\s+\{\s*isCangyuanProvider,\s*usesCangyuanVideoProtocol\s*\}\s+from\s+["']\.\.\/cangyuan-provider["'];?\s*$/m,
    'const isCangyuanProvider = () => false; const usesCangyuanVideoProtocol = () => false;',
  ));
const compiledWithMocks = compiled
  .replace(
    /^\s*import\s+\{\s*getLastModelCall\s*\}\s+from\s+["']\.\.\/model-preferences["'];?\s*$/m,
    'const getLastModelCall = () => null;',
  )
  .replace(
    /^\s*import\s+\{\s*selectAutomaticModel\s*\}\s+from\s+["']\.\.\/model-selection["'];?\s*$/m,
    `const selectAutomaticModel = (models, defaultProviderId, defaultModelId) => {
      const providerModels = defaultProviderId ? models.filter((model) => model.providerId === defaultProviderId) : [];
      return providerModels.find((model) => model.id === defaultModelId)
        || providerModels[0]
        || models.find((model) => model.id === defaultModelId)
        || models[0];
    };`,
  );
const settings = await import(`data:text/javascript;base64,${Buffer.from(compiledWithMocks).toString('base64')}`);

const runtime = {
  models: [
    { id: 'qwen-edit', providerId: 'modelscope', kind: 'image', enabled: true, published: true, capabilities: ['edit', 'reference'] },
    { id: 'gpt-image', providerId: 'draw', kind: 'image', enabled: true, published: true, capabilities: ['generate'] },
  ],
  settings: {
    agentModelId: null,
    defaultImageModelId: 'gpt-image',
    defaultVideoModelId: null,
    defaultProviderId: null,
  },
};

test('pure image generation excludes edit-only models and honors the configured default', () => {
  assert.deepEqual(settings.imageModelOptions(runtime).map((model) => model.id), ['gpt-image']);
  const selected = settings.resolveAvailableCreationModel(settings.defaultImageCreationSettings(runtime), runtime);
  assert.equal(selected.model?.id, 'gpt-image');
  assert.equal(settings.imageModelIdForRequest(settings.defaultImageCreationSettings(runtime)), 'auto');
  assert.equal(settings.imageModelIdForRequest({ ...settings.defaultImageCreationSettings(runtime), model: 'gpt-image' }), 'gpt-image');
  assert.equal(settings.imageModelIdForRequest({ ...settings.defaultImageCreationSettings(runtime), model: 'removed-model' }), 'removed-model');
});

test('automatic video settings resolve the actual default video model', () => {
  const videoRuntime = {
    ...runtime,
    models: [
      { id: 'agnes-v20', rawId: 'agnes-video-v2.0', displayName: 'Agnes Video V2.0', providerId: 'agnes', kind: 'video', enabled: true, published: true, capabilities: ['video-generate', 'video-first-frame', 'video-reference'] },
      { id: 'generic-video', rawId: 'generic-video', displayName: 'Generic Video', providerId: 'draw', kind: 'video', enabled: true, published: true, capabilities: ['video-generate'] },
    ],
    providers: [
      { id: 'agnes', name: 'Agnes', platform: 'agnes' },
      { id: 'draw', name: 'Draw', platform: 'openai' },
    ],
    settings: {
      ...runtime.settings,
      defaultVideoModelId: 'agnes-v20',
      defaultProviderId: 'agnes',
    },
  };
  const selected = settings.resolveAvailableCreationModel(settings.defaultVideoCreationSettings(videoRuntime), videoRuntime);
  assert.equal(selected.model?.id, 'agnes-v20');
  assert.equal(selected.model?.rawId, 'agnes-video-v2.0');
});

const actualVideoSettings = createTsRequire(process.cwd(), {
  '../model-preferences': { getLastModelCall: () => null },
})('./lib/creation/settings');
const podcastRuntime = {
  ...runtime,
  models: [
    { id: 'podcast', rawId: 'mu1-muse-podcast', displayName: 'Muse Podcast', providerId: 'cangyuan', kind: 'video', enabled: true, published: true, capabilities: ['video-generate'] },
    { id: 'short-video', rawId: 'sd20-seedance-2.0-fast', displayName: 'Seedance Fast', providerId: 'cangyuan', kind: 'video', enabled: true, published: true, capabilities: ['video-generate'] },
  ],
  providers: [{ id: 'cangyuan', platform: 'cangyuan', videoTransport: 'cangyuan-videos' }],
  settings: { ...runtime.settings, defaultVideoModelId: 'podcast', defaultProviderId: 'cangyuan' },
};

test('shared video settings preserve documented long podcast durations for manual and automatic models', () => {
  for (const model of ['podcast', 'auto']) {
    for (const duration of [30, 120, 1800]) {
      const result = actualVideoSettings.normalizeVideoCreationSettings({ model, duration }, podcastRuntime);
      assert.equal(result.duration, duration);
      assert.equal(result.model, model);
    }
  }
});

test('shared video duration normalization respects each documented model range', () => {
  for (const [duration, expected] of [[29, 30], [1801, 1800]]) {
    assert.equal(actualVideoSettings.normalizeVideoCreationSettings({ model: 'podcast', duration }, podcastRuntime).duration, expected);
  }
  assert.equal(actualVideoSettings.normalizeVideoCreationSettings({ model: 'podcast' }, podcastRuntime).duration, 30);
  assert.equal(actualVideoSettings.normalizeVideoCreationSettings({ model: 'short-video', duration: 120 }, podcastRuntime).duration, 15);
});

test('saved long video settings survive normalization without a loaded runtime catalog', () => {
  for (const duration of [120, 1800]) {
    const saved = actualVideoSettings.normalizeVideoCreationSettings({ model: 'podcast', duration }, podcastRuntime);
    const restored = actualVideoSettings.normalizeVideoCreationSettings(JSON.parse(JSON.stringify(saved)));
    assert.equal(restored.duration, duration);
    assert.equal(restored.model, 'podcast');
    assert.equal(actualVideoSettings.normalizeVideoCreationSettings(restored, podcastRuntime).duration, duration);
  }
  assert.equal(actualVideoSettings.normalizeVideoCreationSettings({ model: 'podcast', duration: 1801 }).duration, 1800);
});

test('shared video settings do not expand generic or explicit native-task provider limits by model name', () => {
  for (const provider of [
    { id: 'cangyuan', platform: 'custom', videoTransport: 'openai-videos' },
    { id: 'cangyuan', platform: 'cangyuan', videoTransport: 'native-task' },
  ]) {
    const result = actualVideoSettings.normalizeVideoCreationSettings({ model: 'podcast', duration: 120 }, { ...podcastRuntime, providers: [provider] });
    assert.equal(result.duration, 60);
  }
});

test('video settings expose shared Agnes V2.0 presets and backward-compatible defaults', () => {
  assert.deepEqual(settings.AGNES_V20_DURATION_PRESETS.map(({ frames, frameRate }) => ({ frames, frameRate })), [
    { frames: 81, frameRate: 24 },
    { frames: 121, frameRate: 24 },
    { frames: 241, frameRate: 24 },
    { frames: 441, frameRate: 24 },
  ]);
  assert.deepEqual(settings.AGNES_V20_DIMENSION_PRESETS.map(({ width, height }) => ({ width, height })), [
    { width: 1152, height: 768 },
    { width: 1024, height: 576 },
    { width: 576, height: 1024 },
    { width: 768, height: 768 },
  ]);
  const defaults = settings.defaultVideoCreationSettings(runtime);
  assert.deepEqual({
    width: defaults.agnesWidth,
    height: defaults.agnesHeight,
    numFrames: defaults.agnesNumFrames,
    frameRate: defaults.agnesFrameRate,
  }, { width: 1152, height: 768, numFrames: 81, frameRate: 24 });
  const legacy = settings.normalizeVideoCreationSettings({ kind: 'video', model: 'agnes-v20' }, runtime);
  assert.deepEqual({
    width: legacy.agnesWidth,
    height: legacy.agnesHeight,
    numFrames: legacy.agnesNumFrames,
    frameRate: legacy.agnesFrameRate,
  }, { width: 1152, height: 768, numFrames: 81, frameRate: 24 });
});

test('Agnes V2.0 custom video settings are normalized to provider constraints', () => {
  const result = settings.normalizeVideoCreationSettings({
    kind: 'video',
    agnesWidth: 1000,
    agnesHeight: 4000,
    agnesNumFrames: 82,
    agnesFrameRate: 99,
  }, runtime);
  assert.deepEqual({
    width: result.agnesWidth,
    height: result.agnesHeight,
    numFrames: result.agnesNumFrames,
    frameRate: result.agnesFrameRate,
  }, { width: 1024, height: 3840, numFrames: 81, frameRate: 60 });

  const invalid = settings.normalizeVideoCreationSettings({
    kind: 'video',
    agnesWidth: 1,
    agnesHeight: 63,
    agnesNumFrames: 0,
    agnesFrameRate: 0,
  }, runtime);
  assert.deepEqual({
    width: invalid.agnesWidth,
    height: invalid.agnesHeight,
    numFrames: invalid.agnesNumFrames,
    frameRate: invalid.agnesFrameRate,
  }, { width: 64, height: 64, numFrames: 1, frameRate: 1 });
});

test('video creation settings preserve typed model parameters for canvas node persistence', () => {
  const result = settings.normalizeVideoCreationSettings({
    kind: 'video',
    model: 'cangyuan-video-model',
    modelParameters: { camera_movement: 'orbit', seed: '42', generate_audio: false },
  }, runtime);
  assert.deepEqual(result.modelParameters, {
    camera_movement: 'orbit',
    seed: '42',
    generate_audio: false,
  });

  const malformed = settings.normalizeVideoCreationSettings({ kind: 'video', modelParameters: ['invalid'] }, runtime);
  assert.deepEqual(malformed.modelParameters, {});
});

test('image settings retain local-edit annotations in the persisted mask', () => {
  const result = settings.normalizeImageCreationSettings({
    kind: 'image',
    model: 'qwen-edit',
    mask: {
      url: '/mask.png',
      sourceUrl: '/legacy-source.png',
      sourceImageDataUrl: 'data:image/png;base64,legacy-source',
      moveSourceMaskAssetId: 'legacy-source-mask-asset',
      moveSourceMaskUrl: '/legacy-source-mask.png',
      feather: 99,
      annotations: [{
        id: 'text',
        kind: 'rectangle',
        description: '替换背景文字',
        geometry: { kind: 'rectangle', x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
        createdAt: 456,
        move: {
          from: [{ kind: 'rectangle', x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
        },
      }],
    },
  }, runtime);

  assert.equal(result.mask?.annotations?.[0].description, '替换背景文字');
  assert.equal(result.mask?.annotations?.[0].move?.from[0].x, 0.1);
  assert.equal(result.mask?.feather, 48);
  assert.equal(result.mask?.sourceUrl, '/legacy-source.png');
  assert.equal(result.mask?.sourceImageDataUrl, 'data:image/png;base64,legacy-source');
  assert.equal(result.mask?.moveSourceMaskAssetId, 'legacy-source-mask-asset');
  assert.equal(result.mask?.moveSourceMaskUrl, '/legacy-source-mask.png');
});

test('image settings preserve documented Cangyuan quality and output format values', () => {
  const result = settings.normalizeImageCreationSettings({
    kind: 'image',
    quality: 'xhigh',
    outputFormat: 'svg',
  }, runtime);

  assert.equal(result.quality, 'xhigh');
  assert.equal(result.outputFormat, 'svg');
});

test('legacy string masks remain readable while new feather metadata is normalized', () => {
  const result = settings.normalizeImageCreationSettings({
    kind: 'image',
    model: 'qwen-edit',
    mask: '/legacy-mask.png',
  }, runtime);

  assert.equal(result.mask?.url, '/legacy-mask.png');
  assert.equal(result.mask?.feather, undefined);
});

test('shared image defaults never retain a local-edit mask', () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    dispatchEvent: () => true,
  };

  try {
    values.set(settings.SHARED_CREATION_SETTINGS_KEY, JSON.stringify({
      image: {
        aspect: '16:9',
        mask: { url: '/stale-mask.png', annotations: [{ id: 'stale' }] },
      },
    }));
    assert.equal(settings.readSharedCreationSettings('image', runtime).mask, undefined);

    settings.writeSharedCreationSettings({
      ...settings.defaultImageCreationSettings(runtime),
      mask: { url: '/new-mask.png', annotations: [{ id: 'new' }] },
    });
    const stored = JSON.parse(values.get(settings.SHARED_CREATION_SETTINGS_KEY));
    assert.equal(stored.image.mask, undefined);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

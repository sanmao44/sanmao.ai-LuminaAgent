import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

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
const sourceUrl = new URL('../lib/creation/settings.ts', import.meta.url);
const compiled = await compileTypeScript('../lib/creation/settings.ts', (source) => source
  .replace(
    /^import\s+\{\s*normalizeLocalEditAnnotations\s*,\s*type\s+LocalEditAnnotation\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m,
    localEditRuntime,
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

test('image settings retain local-edit annotations in the persisted mask', () => {
  const result = settings.normalizeImageCreationSettings({
    kind: 'image',
    model: 'qwen-edit',
    mask: {
      url: '/mask.png',
      sourceUrl: '/legacy-source.png',
      sourceImageDataUrl: 'data:image/png;base64,legacy-source',
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

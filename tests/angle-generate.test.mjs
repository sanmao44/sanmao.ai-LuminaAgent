import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const angleSource = await readFile(new URL('../lib/angle-control.ts', import.meta.url), 'utf8');
const modelSelectionSource = await readFile(new URL('../lib/model-selection.ts', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../app/api/generate/route.ts', import.meta.url), 'utf8');
function load(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const angle = load(angleSource);
const modelSelection = load(modelSelectionSource);

test('model capability matching requires every capability and rejects incomplete reference models', () => {
  const required = ['generate', 'reference'];
  assert.equal(modelSelection.modelSupportsCapabilities({ capabilities: ['generate', 'reference', 'edit'] }, required), true);
  assert.equal(modelSelection.modelSupportsCapabilities({ capabilities: ['generate', 'edit'] }, required), false);
  assert.equal(modelSelection.modelSupportsCapabilities({ capabilities: ['reference'] }, required), false);
});

function harness(options = {}) {
  const calls = { edits: [], generations: [], logs: [], finishes: [], releases: 0, modelLookups: [], generationLookups: [], capabilityLookups: [], candidateLookups: [], intentInputs: [] };
  const runtime = options.runtime || { provider: { id: 'test-provider', name: 'Test' }, model: { id: 'test-edit', rawId: 'gpt-image-2', displayName: 'Test Edit', capabilities: ['generate', 'edit', 'reference'] } };
  const route = load(routeSource, {
    '@/lib/angle-control': angle,
    '@/apps/api/image-intent-composition': {
      resolveCanvasImageRequestIntent: async input => {
        calls.intentInputs.push(input);
        if (options.intentResolution) return options.intentResolution;
        return input.isCanvasRequest
          ? { operation: 'reference-generate', classifierStatus: 'used', classifierModelId: 'jev-runtime', classifierMs: 12 }
          : { operation: input.imageReferenceCount ? 'reference-generate' : 'generate', ...(input.imageReferenceCount ? { classifierStatus: 'unavailable' } : {}) };
      },
    },
    '@/lib/providers': {
      editImage: async (_provider, _model, input) => {
        calls.edits.push(input);
        if (options.editError) throw options.editError;
        return options.editImages || [];
      },
      generateImage: async (_provider, _model, input) => { calls.generations.push(input); return options.generationImages || []; },
      imageDownloadAuth: () => undefined,
      isProviderEndpointNotFound: error => error?.providerFailureKind === 'http' && error?.providerStatus === 404,
    },
    '@/lib/store': {
      getRuntimeImageModelForCapability: async (id, capability) => {
        calls.modelLookups.push(id);
        if (id === 'missing' || (id === options.incompatibleModelId && capability === options.incompatibleCapability)) return null;
        return runtime;
      },
      getRuntimeImageModelForCapabilities: async (id, capabilities) => {
        calls.capabilityLookups.push({ id, capabilities });
        if (options.noReferenceModel) return null;
        return id === 'missing' ? null : runtime;
      },
      getRuntimeImageGenerationModel: async id => { calls.generationLookups.push(id); return runtime; },
      getRuntimeImageModelCandidates: async (id, capabilities) => {
        calls.candidateLookups.push({ id, capabilities });
        return [runtime];
      },
      getPublicState: async () => ({ settings: {} }),
      markProviderCredentialFailure: async () => {},
    },
    '@/lib/generation-log': {
      startGenerationLog: async input => { calls.logs.push(input); return 'test-log'; },
      finishGenerationLog: async (_id, patch) => { calls.finishes.push(patch); },
      appendGenerationLog: async () => {},
    },
    '@/lib/generation-persistence': { persistGenerationResult: async ({ images }) => ({ images }) },
    '@/lib/angle-image': { renderAngleOutput: () => assert.fail('No real image processing expected') },
    '@/lib/auth': { isTrustedAppRequest: () => true },
    '@/lib/reference-images': { referenceRecordsForLog: value => value || [] },
    '@/lib/generation-source': { normalizeGenerationSource: value => value || 'workspace' },
    '@/lib/local-edit-composite': { enforceLocalEditMask: () => assert.fail('No masks expected') },
    '@/lib/runtime-operation': {
      beginRuntimeRequest: async () => async () => { calls.releases++; },
      RuntimeDrainingError: class extends Error {},
    },
    '@/lib/image-orientation': {
      normalizeStarApiLandscapePrompt: (_provider, _model, prompt) => prompt,
      normalizeStarApiLandscapeImages: async (_provider, _model, _input, images) => {
        if (options.normalizeError) throw options.normalizeError;
        return images;
      },
    },
    '@/packages/model-runtime/media': {
      invokeMediaModelCandidates: async (initial, loadFallbacks, operation) => {
        await loadFallbacks();
        return operation(initial);
      },
    },
    '@/packages/contracts/creative': { MAX_IMAGE_REFERENCES: 16 },
  });
  return {
    calls,
    post: body => route.POST(new Request('http://localhost/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}
const reference = 'data:image/png;base64,b3JpZ2luYWw=';
const guide = 'data:image/png;base64,Z3VpZGU=';
const camera = (values = {}, view = {}) => ({
  ...angle.createViewpointCamera(), ...values,
  viewpoint: angle.normalizeViewpointOptions(view),
});

test('single-reference viewpoint request reaches editImage with the original and compiled lighting', async () => {
  const api = harness();
  const state = camera({ yaw: -45 }, { subjectType: 'product', lighting: { enabled: true, azimuth: 60, temperature: 3200 } });
  const response = await api.post({ camera: state, references: [reference], angleNote: '保留品牌标志' });
  assert.equal(response.status, 200);
  assert.equal(api.calls.generations.length, 0);
  assert.equal(api.calls.edits.length, 1);
  const input = api.calls.edits[0];
  assert.deepEqual(input.references, [reference]);
  assert.equal(input.fidelity, 'high');
  assert.match(input.prompt, /45 degrees to the LEFT/);
  assert.match(input.prompt, /60 degrees right/);
  assert.match(input.prompt, /3200K/);
  assert.match(input.prompt, /保留品牌标志/);
  assert.doesNotMatch(input.prompt, /Image 2/);
  assert.equal(api.calls.logs[0].angle.camera.coordinate_system, 'reference-relative-v2');
  assert.equal(api.calls.logs[0].angle.camera.viewpoint.lighting.temperature, 3200);
  assert.equal(api.calls.releases, 1);
});

test('optional guide preserves original-first ordering and original-light instructions', async () => {
  const api = harness();
  const response = await api.post({ camera: camera({}, { guide: true }), references: [reference, guide], width: 1024, height: 1024 });
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls.edits[0].references, [reference, guide]);
  assert.match(api.calls.edits[0].prompt, /Image 2 is an OPTIONAL/);
  assert.match(api.calls.edits[0].prompt, /Preserve the original world-space illumination/);
});

test('lighting-only ignores stored camera changes and never requires or mentions a guide', async () => {
  const api = harness();
  const response = await api.post({
    camera: camera({ yaw: 135, pitch: -40, roll: 20, distance: 4.4 }, { changeView: false, guide: true, lighting: { enabled: true } }),
    references: [reference], angleGuide: true,
  });
  assert.equal(response.status, 200);
  assert.match(api.calls.edits[0].prompt, /Do not level, rotate or crop/);
  assert.doesNotMatch(api.calls.edits[0].prompt, /Image 2|135 degrees|20°/);
  assert.equal(api.calls.logs[0].angle.camera.yaw_deg, 0);
  assert.equal(api.calls.logs[0].angle.camera.semantic_target.roll.postprocess_degrees, 0);
});

test('invalid references, modes and out-of-range numbers fail before a model call', async () => {
  const defaultCamera = camera();
  const requests = [
    { camera: defaultCamera },
    { camera: defaultCamera, references: [reference, guide] },
    { camera: camera({}, { guide: true }), references: [reference] },
    { camera: camera({}, { guide: true }), references: [reference, guide] },
    { camera: { ...defaultCamera, viewpoint: { version: 2, mode: 'invalid' } }, references: [reference] },
    { camera: { ...defaultCamera, viewpoint: { version: 3 } }, references: [reference] },
    { camera: { ...defaultCamera, viewpoint: { version: 2, lighting: { azimuth: 200 } } }, references: [reference] },
    { camera: { ...defaultCamera, subjectYaw: 30 }, references: [reference] },
    ...Object.entries(angle.VIEWPOINT_LIMITS).flatMap(([field, [min, max]]) => [min - 1, max + 1, 'bad'].map(value => ({
      camera: { ...defaultCamera, [field]: value }, references: [reference],
    }))),
    ...[0, 8193, 256.5, 'Infinity'].map(width => ({ camera: defaultCamera, references: [reference], width, height: 1024 })),
  ];
  for (const request of requests) {
    const api = harness();
    const response = await api.post(request);
    assert.equal(response.status, 400, JSON.stringify(request));
    assert.equal(api.calls.edits.length + api.calls.generations.length, 0);
    assert.equal(api.calls.releases, 1);
  }
});

test('missing manual model is not silently replaced and plain prompt is kept without angleNote', async () => {
  const api = harness();
  assert.equal((await api.post({ camera: camera(), model: 'missing', references: [reference] })).status, 400);
  assert.deepEqual(api.calls.modelLookups, ['missing']);
  const valid = harness();
  await valid.post({ camera: camera(), references: [reference], prompt: '保留窗户位置' });
  assert.match(valid.calls.edits[0].prompt, /USER REQUEST\n保留窗户位置/);
});

test('legacy camera and ordinary generation keep their existing paths', async () => {
  const legacy = harness();
  assert.equal((await legacy.post({ camera: { yaw: 270, pitch: -80 }, references: [reference] })).status, 200);
  assert.equal(legacy.calls.edits[0].fidelity, 'low');
  const ordinary = harness();
  assert.equal((await ordinary.post({ prompt: 'A landscape' })).status, 200);
  assert.equal(ordinary.calls.generations.length, 1);
  assert.equal(ordinary.calls.edits.length, 0);
});

test('Canvas auto intent keeps linked references on the reference-capable generation path', async () => {
  const api = harness({ generationImages: [{ url: '/generated-shandong.png' }] });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'auto',
    prompt: '保持参考图的构图风格，生成山东主题并替换全部地域元素',
    references: [reference],
    referenceImages: [{ name: '河南参考', url: '/henan.png' }],
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.mode, 'generate');
  assert.equal(body.operation, 'reference-generate');
  assert.equal(api.calls.edits.length, 0);
  assert.equal(api.calls.generations.length, 1);
  assert.deepEqual(api.calls.generations[0].references, [reference]);
  assert.deepEqual(api.calls.intentInputs.map(input => input.imageReferenceCount), [1]);
  assert.deepEqual(api.calls.capabilityLookups, [{ id: 'auto', capabilities: ['generate', 'reference'] }]);
  assert.deepEqual(api.calls.candidateLookups, [{ id: 'auto', capabilities: ['generate', 'reference'] }]);
  assert.deepEqual(api.calls.modelLookups, []);
  assert.equal(api.calls.logs[0].mode, 'generate');
  assert.equal(api.calls.logs[0].operation, 'reference-generate');
  assert.equal(api.calls.logs[0].intentClassifierStatus, 'used');
  assert.equal(api.calls.logs[0].intentClassifierModelId, 'jev-runtime');
});

test('Canvas generation reuses a preflight JEV decision without classifying twice', async () => {
  const api = harness({ generationImages: [{ url: '/generated-from-reference.png' }] });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'reference-generate',
    imageIntentPreview: {
      operation: 'reference-generate',
      classifierStatus: 'used',
      classifierModelId: 'jev-runtime',
      classifierMs: 21,
    },
    prompt: 'Create a new scene using the linked image',
    references: [reference],
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.operation, 'reference-generate');
  assert.equal(api.calls.intentInputs.length, 0);
  assert.equal(api.calls.generations.length, 1);
  assert.deepEqual(api.calls.generations[0].references, [reference]);
  assert.equal(api.calls.logs[0].intentClassifierStatus, 'used');
  assert.equal(api.calls.logs[0].intentClassifierModelId, 'jev-runtime');
  assert.equal(api.calls.logs[0].intentClassifierMs, 21);
});

test('Canvas JEV edit decision routes linked image to edit capability and endpoint', async () => {
  const api = harness({ editImages: [{ url: '/edited.png' }], intentResolution: { operation: 'edit', classifierStatus: 'used' } });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'auto',
    prompt: '只调整原图光线',
    references: [reference],
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.operation, 'edit');
  assert.equal(api.calls.generations.length, 0);
  assert.equal(api.calls.edits.length, 1);
  assert.deepEqual(api.calls.modelLookups, ['auto']);
  assert.equal(api.calls.capabilityLookups.length, 0);
  assert.equal(api.calls.logs[0].operation, 'edit');
});

test('uncertain JEV decisions conservatively use connected references for a new image', async () => {
  const api = harness({
    generationImages: [{ url: '/fallback-reference.png' }],
    intentResolution: { operation: 'reference-generate', classifierStatus: 'fallback', classifierMs: 2000 },
  });
  const response = await api.post({ source: 'canvas', imageOperation: 'auto', prompt: 'Create a new scene', references: [reference] });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.operation, 'reference-generate');
  assert.equal(api.calls.generations.length, 1);
  assert.deepEqual(api.calls.generations[0].references, [reference]);
  assert.equal(api.calls.logs[0].intentClassifierStatus, 'fallback');
});

test('reference-generation rejects a selected model that lacks the required capabilities', async () => {
  const api = harness({ noReferenceModel: true });
  const response = await api.post({
    source: 'canvas', imageOperation: 'reference-generate', model: 'selected-model',
    prompt: 'Use the linked image as reference', references: [reference],
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /generate 和 reference/);
  assert.equal(api.calls.generations.length + api.calls.edits.length, 0);
  assert.deepEqual(api.calls.capabilityLookups, [{ id: 'selected-model', capabilities: ['generate', 'reference'] }]);
});

test('explicit canvas edits keep the edit capability and endpoint', async () => {
  const api = harness({ editImages: [{ url: '/edited.png' }] });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'edit',
    prompt: '只调整原图光线',
    references: [reference],
  });
  assert.equal(response.status, 200);
  assert.equal(api.calls.generations.length, 0);
  assert.equal(api.calls.edits.length, 1);
  assert.deepEqual(api.calls.modelLookups, ['auto']);
  assert.equal(api.calls.logs[0].mode, 'edit');
});

test('invalid canvas image operation fails before selecting or calling a model', async () => {
  const api = harness();
  const response = await api.post({ source: 'canvas', imageOperation: 'unknown', prompt: 'A landscape' });
  assert.equal(response.status, 400);
  assert.equal(api.calls.generations.length + api.calls.edits.length, 0);
  assert.equal(api.calls.generationLookups.length + api.calls.modelLookups.length, 0);
});

test('references without an explicit operation use the reference-generation capability path', async () => {
  const api = harness({ generationImages: [{ url: '/generated.png' }] });
  const response = await api.post({
    prompt: '保持参考图构图，改为山东主题并替换地域元素',
    references: [reference],
    referenceImages: [
      { id: 'reference-1', name: '原图', url: '/source.png' },
      { id: 'unsubmitted', name: '未提交参考', url: '/unused.png' },
    ],
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.mode, 'generate');
  assert.equal(body.operation, 'reference-generate');
  assert.equal(api.calls.edits.length, 0);
  assert.deepEqual(api.calls.generations[0].references, [reference]);
  assert.deepEqual(api.calls.capabilityLookups, [{ id: 'auto', capabilities: ['generate', 'reference'] }]);
  assert.deepEqual(api.calls.logs[0].references, [{ id: 'reference-1', name: '原图', url: '/source.png', kind: 'image' }]);
});

test('an explicitly selected model is not silently replaced when JEV chooses an unsupported operation', async () => {
  const api = harness({
    intentResolution: { operation: 'edit', classifierStatus: 'used' },
    incompatibleModelId: 'selected-model',
    incompatibleCapability: 'edit',
  });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'auto',
    model: 'selected-model',
    prompt: '只调整原图光线',
    references: [reference],
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /当前选中的图片模型不支持改图/);
  assert.deepEqual(api.calls.modelLookups, ['selected-model']);
  assert.equal(api.calls.edits.length + api.calls.generations.length, 0);
});

test('the generate route rejects excess image references instead of truncating their provenance', async () => {
  const api = harness();
  const response = await api.post({
    imageOperation: 'auto',
    prompt: 'too many references',
    references: Array.from({ length: 17 }, (_, index) => `data:image/png;base64,REF${index + 1}`),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /最多 16 张/);
  assert.equal(api.calls.intentInputs.length, 0);
  assert.equal(api.calls.capabilityLookups.length + api.calls.modelLookups.length, 0);
});

test('the generate route rejects malformed reference slots instead of shifting provenance order', async () => {
  const api = harness();
  const response = await api.post({
    imageOperation: 'auto',
    prompt: 'preserve source order',
    references: [reference, '', guide],
    referenceImages: [
      { id: 'source', name: '原图', url: '/source.png' },
      { id: 'guide', name: '导引图', url: '/guide.png' },
    ],
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /参考图数据格式无效/);
  assert.equal(api.calls.capabilityLookups.length + api.calls.modelLookups.length, 0);
});

test('the generate route rejects a non-array reference payload instead of treating it as text-only generation', async () => {
  const api = harness();
  const response = await api.post({
    imageOperation: 'auto',
    prompt: 'preserve the source image',
    references: { url: reference },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /参考图数据格式无效/);
  assert.equal(api.calls.intentInputs.length, 0);
  assert.equal(api.calls.capabilityLookups.length + api.calls.modelLookups.length, 0);
});

test('provider image remains successful when local post-processing fails', async () => {
  const api = harness({
    generationImages: [{ url: 'https://provider.example/result.png' }],
    normalizeError: new Error('本地方向处理失败'),
  });
  const response = await api.post({ prompt: 'A landscape' });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.images, [{ url: 'https://provider.example/result.png' }]);
  assert.match(body.warning, /图片已生成/);
});

test('image edit keeps a provider image successful when local post-processing fails', async () => {
  const providerImage = { url: 'https://provider.example/edited.png' };
  const persisted = [];
  const editSource = await readFile(new URL('../app/api/edit/route.ts', import.meta.url), 'utf8');
  const editCompiled = ts.transpileModule(editSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const editModule = { exports: {} };
  const editRuntime = {
    provider: { id: 'provider', name: 'Provider' },
    model: { id: 'edit-model', rawId: 'edit-model', displayName: 'Edit model' },
  };
  new Function('require', 'module', 'exports', editCompiled)(name => {
    const dependencies = {
      '@/lib/providers': {
        editImage: async () => [providerImage],
        imageDownloadAuth: () => undefined,
      },
      '@/lib/image-storage': { resolveStoredImageReference: async value => value },
      '@/lib/generation-log': {
        startGenerationLog: async () => 'edit-result-recovery',
        finishGenerationLog: async () => {},
        appendGenerationLog: async () => {},
      },
      '@/lib/generation-persistence': {
        persistGenerationResult: async input => {
          persisted.push(input);
          return { images: input.images, path: input.storagePath || '' };
        },
      },
      '@/lib/store': {
        getPublicState: async () => ({ settings: {} }),
        getRuntimeImageModelForCapability: async () => editRuntime,
        getRuntimeImageModelCandidates: async () => [],
        markProviderCredentialFailure: async () => {},
      },
      '@/lib/auth': { isTrustedAppRequest: () => true },
      '@/lib/reference-images': { referenceRecordsForLog: () => [] },
      '@/lib/local-edit-composite': { enforceLocalEditMask: async images => images },
      '@/lib/runtime-operation': {
        beginRuntimeRequest: async () => async () => {},
        RuntimeDrainingError: class extends Error {},
      },
      '@/lib/image-orientation': {
        normalizeStarApiLandscapePrompt: (_provider, _model, prompt) => prompt,
        normalizeStarApiLandscapeImages: async () => { throw new Error('本地后处理失败'); },
      },
      '@/packages/model-runtime/media': {
        invokeMediaModelCandidates: async (initial, _loadFallbacks, operation) => operation(initial),
      },
    };
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, editModule, editModule.exports);
  const response = await editModule.exports.POST(new Request('http://localhost/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '把背景换成夜晚', references: ['data:image/png;base64,dGVzdA=='] }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.images, [providerImage]);
  assert.match(body.warning, /图片已生成/);
  assert.deepEqual(persisted.map(item => item.images), [[providerImage]]);
});

test('canvas single-source continuation falls back to generation when the edit route is missing', async () => {
  const api = harness({
    editError: Object.assign(new Error('服务商接口返回 HTTP 404：404 page not found'), { providerFailureKind: 'http', providerStatus: 404 }),
    generationImages: [{ url: '/generated-without-edit.png' }],
  });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'edit',
    prompt: '换成清晨光线',
    references: [reference],
    fallbackToGenerationOnEdit404: true,
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(api.calls.edits.length, 1);
  assert.equal(api.calls.generations.length, 1);
  assert.equal(body.mode, 'generate-fallback');
  assert.equal(body.operation, 'generate');
  assert.deepEqual(api.calls.generations[0].references, [reference]);
  assert.ok(api.calls.finishes.some(patch => patch.mode === 'generate' && patch.operation === 'generate'));
  assert.match(body.warning, /普通生图/);
});

test('post-processing recovery returns the JEV-selected operation with the preserved image', async () => {
  const api = harness({
    generationImages: [{ url: 'https://provider.example/result.png' }],
    normalizeError: new Error('本地方向处理失败'),
  });
  const response = await api.post({
    source: 'canvas',
    imageOperation: 'auto',
    prompt: '以参考图为基础生成新图',
    references: [reference],
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.operation, 'reference-generate');
  assert.deepEqual(body.images, [{ url: 'https://provider.example/result.png' }]);
});

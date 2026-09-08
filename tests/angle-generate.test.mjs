import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const angleSource = await readFile(new URL('../lib/angle-control.ts', import.meta.url), 'utf8');
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

function harness() {
  const calls = { edits: [], generations: [], logs: [], releases: 0, modelLookups: [] };
  const runtime = { provider: { id: 'test-provider', name: 'Test' }, model: { id: 'test-edit', rawId: 'gpt-image-2', displayName: 'Test Edit' } };
  const route = load(routeSource, {
    '@/lib/angle-control': angle,
    '@/lib/providers': {
      editImage: async (_provider, _model, input) => { calls.edits.push(input); return []; },
      generateImage: async (_provider, _model, input) => { calls.generations.push(input); return []; },
    },
    '@/lib/store': {
      getRuntimeImageModelForCapability: async id => { calls.modelLookups.push(id); return id === 'missing' ? null : runtime; },
      getRuntimeImageGenerationModel: async () => runtime,
      getPublicState: async () => ({ settings: {} }),
      markProviderCredentialFailure: async () => {},
    },
    '@/lib/generation-log': {
      startGenerationLog: async input => { calls.logs.push(input); return 'test-log'; },
      finishGenerationLog: async () => {},
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
      normalizeStarApiLandscapeImages: async (_provider, _model, _input, images) => images,
    },
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

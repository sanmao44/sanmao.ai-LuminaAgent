import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const providers = load('./lib/providers');
const modelKind = load('./lib/model-kind');
const { getCangyuanVideoModelCatalog } = load('./lib/cangyuan-video-model-catalog');
const cangyuanProvider = {
  id: 'cangyuan-provider',
  name: '沧元算力',
  type: 'openai-compatible',
  platform: 'cangyuan',
  baseUrl: 'https://direct-api.cangyuansuanli.cn/v1',
  apiKey: 'unused-test-key',
};

test('official Cangyuan video catalog overrides chat and unknown name collisions during discovery', () => {
  const modelIds = getCangyuanVideoModelCatalog()
    .filter((entry) => entry.status === 'current' && entry.spec.capabilityRefs.includes('video'))
    .map((entry) => entry.publicModel);
  const objectModels = providers.normalizeDiscoveredModels({ data: modelIds.map((id) => ({ id })) }, cangyuanProvider);
  const stringModels = providers.normalizeDiscoveredModels({ models: modelIds }, cangyuanProvider);

  assert.equal(objectModels.length, modelIds.length);
  assert.equal(stringModels.length, modelIds.length);
  for (const model of [...objectModels, ...stringModels]) {
    assert.ok(model.capabilities?.includes('video-generate'), model.id);
    assert.equal(modelKind.inferModelKind({ rawId: model.id, capabilities: model.capabilities }), 'video', model.id);
  }
  for (const id of ['gemini-omni-flash', 'gf1-gemini-omni-1.2-flash', 'minimax-h3-2k', 'mm5-minimax-h3']) {
    assert.equal(modelKind.inferModelKind({ rawId: id }), 'chat', id);
  }
});

test('the same Gemini and MiniMax names remain chat models for other providers', () => {
  const otherProvider = {
    ...cangyuanProvider,
    id: 'other-provider',
    name: 'Other Provider',
    platform: 'custom',
    baseUrl: 'https://gateway.example/v1',
  };
  const ids = ['gemini-omni-flash', 'gf1-gemini-omni-flash', 'minimax-h3-2k', 'mm5-minimax-h3'];
  const models = providers.normalizeDiscoveredModels({ data: ids.map((id) => ({ id })) }, otherProvider);

  assert.equal(models.length, ids.length);
  for (const [index, model] of models.entries()) {
    assert.equal(modelKind.inferModelKind({ rawId: model.id }), 'chat', model.id);
    assert.ok(!model.capabilities?.includes('video-generate'), ids[index]);
  }
});

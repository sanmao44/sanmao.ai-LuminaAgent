import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const picker = createTsRequire(process.cwd())('./lib/model-picker');
const classifier = createTsRequire(process.cwd())('./lib/intent-classifier');

const model = (id, providerName = '接口 A') => ({
  id,
  providerId: providerName,
  providerName,
  rawId: `raw-${id}`,
  displayName: id,
  kind: 'image',
  enabled: true,
  published: true,
  capabilities: [],
});

test('model search matches display name, raw id and provider name', () => {
  assert.equal(picker.modelPickerMatches(model('image-2', '图片接口'), 'image-2'), true);
  assert.equal(picker.modelPickerMatches(model('image-2', '图片接口'), '图片接口'), true);
  assert.equal(picker.modelPickerMatches(model('image-2'), '不存在'), false);
});

test('quick model slices remove duplicates across sections and respect their limit', () => {
  const seen = new Set();
  const models = [model('a'), model('b'), model('a'), model('c'), model('d')];
  assert.deepEqual(picker.takeUniqueModelSlice(models, seen, 3).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(picker.takeUniqueModelSlice([model('b'), model('d')], seen, 4).map((item) => item.id), ['d']);
});

test('model capability requirements require every requested capability', () => {
  const referenceModel = { ...model('reference-model'), capabilities: ['generate', 'reference'] };
  const generateOnlyModel = { ...model('generate-model'), capabilities: ['generate'] };

  assert.equal(picker.modelSupportsCapabilityRequirements(referenceModel, ['generate', 'reference']), true);
  assert.equal(picker.modelSupportsCapabilityRequirements(generateOnlyModel, ['generate', 'reference']), false);
  assert.equal(picker.modelSupportsCapabilityRequirements(generateOnlyModel, ['edit']), false);
});

test('ordinary chat pickers exclude active and legacy internal JEV models', () => {
  const chatModel = (rawId) => ({
    ...model(rawId),
    rawId,
    kind: 'chat',
    capabilities: ['chat'],
  });

  assert.equal(picker.modelPickerModelIsAvailable(chatModel('jev-1.13'), ['chat'], classifier.isInternalIntentModel), false);
  assert.equal(picker.modelPickerModelIsAvailable(chatModel('provider/jev-1.13'), ['chat'], classifier.isInternalIntentModel), false);
  assert.equal(picker.modelPickerModelIsAvailable(chatModel('jev-1.14'), ['chat'], classifier.isInternalIntentModel), false);
  assert.equal(picker.modelPickerModelIsAvailable(chatModel('gpt-5'), ['chat'], classifier.isInternalIntentModel), true);
});

test('video capability fallback remains limited to non-generation video capabilities', () => {
  const legacyVideoModel = { ...model('video-model'), kind: 'video', capabilities: [] };

  assert.equal(picker.modelSupportsCapabilityRequirements(legacyVideoModel, ['video-edit']), true);
  assert.equal(picker.modelSupportsCapabilityRequirements(legacyVideoModel, ['video-generate']), false);
});

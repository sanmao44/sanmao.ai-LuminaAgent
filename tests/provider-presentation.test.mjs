import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const presentation = createTsRequire(process.cwd())('./lib/provider-presentation');

test('provider presentation keeps model kind and protocol labels stable', () => {
  assert.equal(presentation.modelKindLabel('chat'), '对话模型');
  assert.equal(presentation.modelKindLabel('image'), '图片模型');
  assert.equal(presentation.modelKindLabel('unknown'), '未分类');
  assert.equal(presentation.providerTypeLabel('google-gemini'), '谷歌 Gemini');
  assert.equal(presentation.providerTypeLabel('openai-compatible'), '通用兼容接口');
});

test('provider presentation resolves preset labels and manual model capability', () => {
  assert.equal(presentation.providerPlatformLabel('openai'), 'OpenAI');
  assert.equal(presentation.providerPlatformLabel('missing-platform'), '其他平台');
  assert.equal(presentation.isManualModelProvider({ type: 'google-gemini' }), true);
  assert.equal(presentation.isManualModelProvider({ type: 'unsupported' }), false);
  assert.equal(presentation.isManualModelProvider(null), false);
});

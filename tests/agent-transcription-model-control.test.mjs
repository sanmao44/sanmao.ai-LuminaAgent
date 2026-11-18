import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loader = createTsRequire(process.cwd(), {
  '@/components/SelectMenu': {
    __esModule: true,
    default: ({ value, options, ariaLabel }) => createElement('select', { value, onChange: () => undefined, 'aria-label': ariaLabel }, options.map((option) =>
      createElement('option', { key: option.value, value: option.value }, option.label))),
  },
  '@/components/audio/model-options': {
    supportedTranscriptionModels: (state) => state.models,
  },
});
const module = loader('./components/audio/AgentTranscriptionModelControl');

const models = [
  { id: 'asr-one', displayName: '语音模型一', providerName: '服务商一' },
  { id: 'asr-two', displayName: '语音模型二', providerName: '服务商二' },
];

test('multiple chat transcription models require an explicit valid choice', () => {
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(models, ''), { required: true, modelId: undefined });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(models, 'unknown'), { required: true, modelId: undefined });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(models, 'asr-two'), { required: true, modelId: 'asr-two' });
});

test('zero models keep fallback behavior and one model is selected automatically', () => {
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection([], ''), { required: false, modelId: undefined });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection([models[0]], ''), { required: false, modelId: 'asr-one' });
});

test('composer renders an inline picker and blocks on its empty choice only for multiple models', () => {
  const markup = renderToStaticMarkup(createElement(module.default, { models, value: '', onChange: () => undefined }));
  assert.match(markup, /字幕识别/);
  assert.match(markup, /选择模型后才能发送/);
  assert.match(markup, /语音模型一 · 服务商一/);
  assert.match(markup, /语音模型二 · 服务商二/);
  assert.equal(renderToStaticMarkup(createElement(module.default, { models: [models[0]], value: '', onChange: () => undefined })), '');
});

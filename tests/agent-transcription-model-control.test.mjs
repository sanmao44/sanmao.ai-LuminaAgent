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
    supportedTranscriptionModels: (state) => state.models.filter((model) => model.capabilities.includes('transcription')),
  },
});
const module = loader('./components/audio/AgentTranscriptionModelControl');

const provider = (id, platform = 'custom') => ({
  id,
  name: id,
  type: 'openai-compatible',
  platform,
  modelLibraryEnabled: true,
  apiKeyConfigured: true,
  baseUrl: 'https://api.example.test/v1',
  status: 'healthy',
  enabledModelCount: 1,
});
const models = [
  { id: 'asr-one', providerId: 'provider-one', displayName: '语音模型一', providerName: '服务商一', rawId: 'asr-one', capabilities: ['transcription'] },
  { id: 'tts', providerId: 'provider-one', displayName: '配音模型', providerName: '服务商一', rawId: 'tts-1', capabilities: ['speech'] },
  { id: 'asr-two', providerId: 'provider-two', displayName: '语音模型二', providerName: '服务商二', rawId: 'asr-two', capabilities: ['transcription'] },
];
const state = { models, providers: [provider('provider-one'), provider('provider-two')] };

test('multiple chat transcription models require an explicit valid choice', () => {
  const options = module.agentTranscriptionModelOptions(state);
  assert.equal(options.some((option) => option.value === 'tts'), false);
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(options, ''), { required: true, modelId: undefined });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(options, 'unknown'), { required: true, modelId: undefined });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(options, 'asr-two'), { required: true, modelId: 'asr-two' });
});

test('local recognition is always available and Moark free ASR appears only when connected', () => {
  const localOnly = module.agentTranscriptionModelOptions({ models: [], providers: [] });
  assert.deepEqual(module.resolveAgentTranscriptionModelSelection(localOnly, ''), { required: false, modelId: 'local-whisper' });
  const withMoark = module.agentTranscriptionModelOptions({ models: [], providers: [provider('moark', 'gitee')] });
  assert.deepEqual(withMoark.map((option) => option.value), ['local-whisper', 'moark-sensevoice-small']);
  const unconfigured = module.agentTranscriptionModelOptions({ models: [], providers: [{ ...provider('moark', 'gitee'), apiKeyConfigured: false }] });
  assert.deepEqual(unconfigured.map((option) => option.value), ['local-whisper']);
  const disabled = module.agentTranscriptionModelOptions({ models: [], providers: [{ ...provider('moark', 'gitee'), modelLibraryEnabled: false }] });
  assert.deepEqual(disabled.map((option) => option.value), ['local-whisper']);
});

test('composer keeps chat sendable by default and shows model choices only for subtitle generation', () => {
  const chatMarkup = renderToStaticMarkup(createElement(module.default, {
    options: module.agentTranscriptionModelOptions(state), value: '', subtitleRequested: false,
    requiresSelection: false, onChange: () => undefined, onToggleSubtitle: () => undefined,
  }));
  assert.match(chatMarkup, /生成字幕/);
  assert.doesNotMatch(chatMarkup, /选择转写模型/);
  const markup = renderToStaticMarkup(createElement(module.default, {
    options: module.agentTranscriptionModelOptions(state), value: '', subtitleRequested: true,
    requiresSelection: true, onChange: () => undefined, onToggleSubtitle: () => undefined,
  }));
  assert.match(markup, /转写方式/);
  assert.match(markup, /选择一种转写方式后即可生成字幕/);
  assert.match(markup, /语音模型一 · 服务商一/);
  assert.match(markup, /语音模型二 · 服务商二/);
  assert.doesNotMatch(markup, /配音模型/);
});

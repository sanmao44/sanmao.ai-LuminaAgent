import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { supportedSpeechModels } = createTsRequire(process.cwd())('./components/cangyuan/speech-model-options');

test('speech picker excludes transcription models from every provider', () => {
  const state = {
    providers: [
      { id: 'cangyuan', platform: 'cangyuan' },
      { id: 'other', platform: 'openai' },
    ],
    models: [
      { id: 'cangyuan-asr', providerId: 'cangyuan', rawId: 'mu1-muse-asr', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'cangyuan-tts', providerId: 'cangyuan', rawId: 'mu1-muse-tts', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-asr-name', providerId: 'other', rawId: 'mu1-muse-asr', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-tts', providerId: 'other', rawId: 'vendor-tts', enabled: true, published: true, capabilities: ['speech'] },
    ],
  };

  assert.deepEqual(supportedSpeechModels(state).map((model) => model.id), [
    'cangyuan-tts', 'other-tts',
  ]);
});

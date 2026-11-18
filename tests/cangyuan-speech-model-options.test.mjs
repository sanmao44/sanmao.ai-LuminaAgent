import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { supportedSpeechModels, supportedTranscriptionModels, supportedMusicModels, supportedThreeDModels } = createTsRequire(process.cwd())('./components/audio/model-options');

test('audio model pickers include compatible providers without depending on provider brand', () => {
  const state = {
    providers: [
      { id: 'cangyuan', type: 'openai-compatible', platform: 'cangyuan' },
      { id: 'custom-compatible', type: 'openai-compatible', platform: 'custom' },
      { id: 'native-only', type: 'google-gemini', platform: 'google-gemini' },
    ],
    models: [
      { id: 'cangyuan-asr', providerId: 'cangyuan', rawId: 'mu1-muse-asr', enabled: true, published: true, capabilities: ['speech', 'transcription'] },
      { id: 'cangyuan-tts', providerId: 'cangyuan', rawId: 'mu1-muse-tts', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-asr', providerId: 'custom-compatible', rawId: 'vendor-asr', enabled: true, published: true, capabilities: ['transcription'] },
      { id: 'other-tts', providerId: 'custom-compatible', rawId: 'vendor-tts', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-music', providerId: 'custom-compatible', rawId: 'suno-v6', enabled: true, published: true, capabilities: ['music-generate'] },
      { id: 'other-3d', providerId: 'custom-compatible', rawId: 'tripo3d-p2', enabled: true, published: true, capabilities: ['3d-generate'] },
      { id: 'native-tts', providerId: 'native-only', rawId: 'native-tts', enabled: true, published: true, capabilities: ['speech'] },
    ],
  };

  assert.deepEqual(supportedSpeechModels(state).map((model) => model.id), [
    'cangyuan-tts', 'other-tts',
  ]);
  assert.deepEqual(supportedTranscriptionModels(state).map((model) => model.id), ['cangyuan-asr', 'other-asr']);
  assert.deepEqual(supportedMusicModels(state).map((model) => model.id), ['other-music']);
  assert.deepEqual(supportedThreeDModels(state).map((model) => model.id), ['other-3d']);
});

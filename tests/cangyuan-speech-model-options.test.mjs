import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { supportedSpeechModels, supportedTranscriptionModels, supportedMusicModels, supportedThreeDModels } = createTsRequire(process.cwd())('./components/audio/model-options');
const { inferModel } = createTsRequire(process.cwd())('./lib/store');

test('all five Cangyuan speech models are inferred into the speech picker while Muse ASR stays excluded', () => {
  const provider = { id: 'cangyuan', type: 'openai-compatible', platform: 'cangyuan' };
  const speechModelIds = [
    'elevenlabs-dialogue',
    'elevenlabs-v4-tts',
    'gemini-tts',
    'mu1-muse-tts',
    'voice-clone-tts',
  ];
  const models = speechModelIds.map((rawId, index) => {
    const inferred = inferModel(rawId, 'cangyuan');
    assert.equal(inferred.kind, 'audio', rawId);
    assert.ok(inferred.capabilities.includes('speech'), rawId);
    assert.ok(inferred.classification?.purposes.includes('speech'), rawId);
    return {
      id: `cangyuan-speech-${index}`,
      providerId: provider.id,
      providerName: '沧元算力',
      rawId,
      kind: inferred.kind,
      enabled: true,
      published: true,
      capabilities: inferred.capabilities,
    };
  });
  const asr = inferModel('mu1-muse-asr', 'cangyuan');
  assert.equal(asr.kind, 'audio');
  assert.ok(asr.capabilities.includes('transcription'));
  assert.deepEqual(asr.classification?.purposes, ['transcription']);
  models.push({
    id: 'cangyuan-asr',
    providerId: provider.id,
    providerName: '沧元算力',
    rawId: 'mu1-muse-asr',
    kind: asr.kind,
    enabled: true,
    published: true,
    capabilities: asr.capabilities,
  });

  const state = { providers: [provider], models };
  assert.deepEqual(supportedSpeechModels(state).map((model) => model.rawId), speechModelIds);
  assert.deepEqual(supportedTranscriptionModels(state).map((model) => model.rawId), ['mu1-muse-asr']);
});

test('model inference preserves every explicitly declared audio task capability', () => {
  const inferred = inferModel('vendor/audio-model', 'custom', undefined, {
    capabilities: ['speech', 'transcription', 'music-generate'],
  });

  assert.equal(inferred.kind, 'audio');
  assert.deepEqual(inferred.capabilities, ['speech', 'transcription', 'music-generate']);
});

test('music and 3D pickers require the declared creative task protocol', () => {
  const state = {
    providers: [
      { id: 'cangyuan', type: 'openai-compatible', platform: 'cangyuan', creativeTaskProtocol: 'cangyuan-creative-v1' },
      { id: 'custom-no-protocol', type: 'openai-compatible', platform: 'custom' },
      { id: 'custom-compatible', type: 'openai-compatible', platform: 'custom', creativeTaskProtocol: 'cangyuan-creative-v1' },
      { id: 'native-only', type: 'google-gemini', platform: 'google-gemini', creativeTaskProtocol: 'cangyuan-creative-v1' },
    ],
    models: [
      { id: 'cangyuan-asr', providerId: 'cangyuan', rawId: 'mu1-muse-asr', enabled: true, published: true, capabilities: ['transcription'] },
      { id: 'cangyuan-tts', providerId: 'cangyuan', rawId: 'mu1-muse-tts', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-asr', providerId: 'custom-compatible', rawId: 'vendor-asr', enabled: true, published: true, capabilities: ['transcription'] },
      { id: 'other-tts', providerId: 'custom-compatible', rawId: 'vendor-tts', enabled: true, published: true, capabilities: ['speech'] },
      { id: 'other-dual-audio', providerId: 'custom-compatible', rawId: 'vendor-audio', enabled: true, published: true, capabilities: ['speech', 'transcription'] },
      { id: 'undeclared-music', providerId: 'custom-no-protocol', rawId: 'suno-v6', enabled: true, published: true, capabilities: ['music-generate'] },
      { id: 'undeclared-3d', providerId: 'custom-no-protocol', rawId: 'tripo3d-p2', enabled: true, published: true, capabilities: ['3d-generate'] },
      { id: 'other-music', providerId: 'custom-compatible', rawId: 'suno-v6', enabled: true, published: true, capabilities: ['music-generate'] },
      { id: 'other-3d', providerId: 'custom-compatible', rawId: 'tripo3d-p2', enabled: true, published: true, capabilities: ['3d-generate'] },
      { id: 'native-tts', providerId: 'native-only', rawId: 'native-tts', enabled: true, published: true, capabilities: ['speech', 'music-generate', '3d-generate'] },
    ],
  };

  assert.deepEqual(supportedSpeechModels(state).map((model) => model.id), [
    'cangyuan-tts', 'other-tts', 'other-dual-audio',
  ]);
  assert.deepEqual(supportedTranscriptionModels(state).map((model) => model.id), ['cangyuan-asr', 'other-asr', 'other-dual-audio']);
  assert.deepEqual(supportedMusicModels(state).map((model) => model.id), ['other-music']);
  assert.deepEqual(supportedThreeDModels(state).map((model) => model.id), ['other-3d']);
});

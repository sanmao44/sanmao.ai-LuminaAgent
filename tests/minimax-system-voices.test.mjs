import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const voices = createTsRequire(process.cwd())('./packages/contracts/minimax-system-voices');

test('MiniMax system voice directory matches the official 327 unique IDs and preserves request values', () => {
  assert.equal(voices.MINIMAX_SYSTEM_VOICE_COUNT, 327);
  assert.equal(new Set(voices.MINIMAX_SYSTEM_VOICES.map(({ voiceId }) => voiceId)).size, 327);
  assert.deepEqual(voices.MINIMAX_SYSTEM_VOICES.map(({ number }) => number), Array.from({ length: 327 }, (_, index) => index + 1));
  assert.equal(voices.MINIMAX_SYSTEM_VOICES[0].voiceId, 'male-qn-qingse');

  const spacedId = 'French_Female_News Anchor';
  assert.deepEqual(voices.findMiniMaxSystemVoice(spacedId), {
    number: 266,
    language: '法文',
    languageLabel: '法语',
    voiceId: spacedId,
    name: 'Patient Female Presenter',
  });
  assert.deepEqual(voices.searchMiniMaxSystemVoices('印地语').map(({ voiceId }) => voiceId), [
    'hindi_male_1_v2', 'hindi_female_2_v1', 'hindi_female_1_v2',
  ]);
  assert.ok(voices.searchMiniMaxSystemVoices('male-qn-jingying').some(({ voiceId }) => voiceId === 'male-qn-jingying'));
});

test('MiniMax HD and Turbo profiles both require a voice ID and expose their documented controls', () => {
  const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
  for (const model of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
    const profile = contracts.getSpeechModelProfile(model, 'cangyuan');
    assert.ok(profile, `${model} should be registered as a Cangyuan speech model`);
    assert.equal(profile.requiresVoiceId, true);
    assert.deepEqual(profile.responseFormats, ['mp3', 'wav', 'flac']);
    assert.ok(profile.advancedOptionKeys.includes('voiceId'));
    assert.ok(profile.advancedOptionKeys.includes('textNormalizationMode'));
    assert.ok(profile.advancedOptionKeys.includes('soundEffects'));
  }
});

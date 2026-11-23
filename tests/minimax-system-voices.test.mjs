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

test('provider catalogs preserve exact official IDs and Chinese display labels', () => {
  const official = voices.getMiniMaxSystemVoices('cangyuan');
  assert.equal(official.length, 327);
  assert.ok(official.every((voice) => /^voice_builtin_[a-f0-9]{64}$/.test(voice.voiceId)));
  assert.ok(official.every((voice) => /[\u4e00-\u9fff]/u.test(voice.name)));
  assert.equal(official[0].name, '青涩青年音色（测试版）');
  assert.equal(voices.getMiniMaxSystemVoices('other-provider'), voices.MINIMAX_SYSTEM_VOICES);
  const result = voices.searchMiniMaxSystemVoices('Gentle-voiced man', 'cangyuan');
  assert.ok(result.length > 0);
  assert.ok(result.some((voice) => voice.name === '温柔男声'));
  assert.ok(voices.searchMiniMaxSystemVoices('温柔男声', 'cangyuan').length > 0);
});

test('all 327 legacy MiniMax voices resolve by exact official name and normalized language', () => {
  const official = voices.getMiniMaxSystemVoices('cangyuan');
  const resolvedIds = new Set();
  for (const legacy of voices.MINIMAX_SYSTEM_VOICES) {
    const exactMatches = official.filter((voice) => voice.originalName === legacy.name && voice.languageLabel === legacy.languageLabel);
    assert.equal(exactMatches.length, 1, `${legacy.voiceId} must have exactly one same-name same-language entry`);
    const actual = voices.findMiniMaxSystemVoice(legacy.voiceId, 'cangyuan');
    assert.equal(actual, exactMatches[0]);
    assert.equal(voices.resolveMiniMaxSystemVoiceId(legacy.voiceId, 'cangyuan'), exactMatches[0].voiceId);
    assert.equal(voices.resolveMiniMaxSystemVoiceId(exactMatches[0].voiceId, 'cangyuan'), exactMatches[0].voiceId);
    assert.equal(voices.resolveMiniMaxSystemVoiceId(legacy.voiceId, 'other-provider'), legacy.voiceId);
    resolvedIds.add(actual.voiceId);
  }
  assert.equal(resolvedIds.size, 327);
});

test('beta variants and same-name voices in different languages stay distinct', () => {
  const regular = voices.findMiniMaxSystemVoice('male-qn-qingse', 'cangyuan');
  const beta = voices.findMiniMaxSystemVoice('male-qn-qingse-jingpin', 'cangyuan');
  assert.equal(regular.originalName, '青涩青年音色');
  assert.equal(beta.originalName, '青涩青年音色-beta');
  assert.notEqual(regular.voiceId, beta.voiceId);
  const santas = ['Santa_Claus', 'Spanish_SantaClaus', 'Portuguese_SantaClaus'].map((id) => voices.findMiniMaxSystemVoice(id, 'cangyuan'));
  assert.equal(new Set(santas.map((voice) => voice.voiceId)).size, 3);
  assert.deepEqual(santas.map((voice) => voice.languageLabel), ['英语', '西班牙语', '葡萄牙语']);
  assert.ok(santas.every((voice) => voice.originalName === 'Santa Claus'));
  for (const id of ['private-clone-voice', 'unknown', 'Santa Claus', '青涩青年音色-beta', `voice_builtin_${'0'.repeat(64)}`]) {
    assert.equal(voices.findMiniMaxSystemVoice(id, 'cangyuan'), undefined);
    assert.equal(voices.resolveMiniMaxSystemVoiceId(id, 'cangyuan'), undefined);
  }
  assert.equal(voices.resolveMiniMaxSystemVoiceId(beta.voiceId, 'other-provider'), undefined);
});

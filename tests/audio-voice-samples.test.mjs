import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const samples = createTsRequire(process.cwd())('./components/audio/voice-samples');

test('registered speech voice samples map to local audio and retain model and voice metadata', () => {
  const expectedCounts = { 'gemini-tts': 9, 'mu1-muse-tts': 9, 'elevenlabs-v4-tts': 21 };
  for (const model of ['gemini-tts', 'mu1-muse-tts', 'elevenlabs-v4-tts']) {
    const profile = contracts.getSpeechModelProfile(model, 'cangyuan');
    let mappedCount = 0;
    for (const voice of profile.suggestedVoices) {
      const sample = samples.getSpeechVoiceSample(model, voice, 'cangyuan');
      const shouldHaveSample = !(model === 'mu1-muse-tts' && voice === 'sage');
      assert.equal(Boolean(sample), shouldHaveSample, `${model}/${voice} sample availability should be explicit`);
      if (!sample) continue;
      mappedCount += 1;
      const absolutePath = path.join(process.cwd(), 'public', sample.url.replace(/^\//u, ''));
      assert.equal(existsSync(absolutePath), true, `${absolutePath} should exist`);
      assert.ok(statSync(absolutePath).size > 44, `${absolutePath} should contain audio data`);
      assert.equal(sample.provenance.providerKey, 'cangyuan');
      assert.equal(sample.provenance.modelId, model);
      assert.equal(sample.provenance.voiceId, voice);
      assert.ok(sample.provenance.routeModelId, `${model}/${voice} should record the exact selected model registration`);
      assert.equal(sample.provenance.responseModelId, sample.provenance.routeModelId);
      const bytes = readFileSync(absolutePath);
      assert.equal(sample.provenance.bytes, bytes.length);
      assert.equal(sample.provenance.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(sample.text, samples.SAMPLE_TEXT);
    }
    assert.equal(mappedCount, expectedCounts[model]);
  }
  assert.equal(samples.getSpeechVoiceSample('mu1-muse-tts', 'sage', 'cangyuan'), null);
});

test('unknown, custom, and cross-provider voices do not fall back to another sample or billable endpoint', () => {
  assert.equal(samples.getSpeechVoiceSample('unknown-model', 'voice-a', 'cangyuan'), null);
  assert.equal(samples.getSpeechVoiceSample('gemini-tts', 'custom-voice', 'cangyuan'), null);
  assert.equal(samples.getSpeechVoiceSample('gemini-tts', 'Capella', 'other-provider'), null);
  assert.equal(samples.getSpeechVoiceSample('gemini-tts', 'Capella', ''), null);
});

test('ElevenLabs sample mappings cover every documented static voice', () => {
  const profile = contracts.getSpeechModelProfile('elevenlabs-v4-tts', 'cangyuan');
  for (const voice of profile.suggestedVoices) {
    const sample = samples.getSpeechVoiceSample('elevenlabs-v4-tts', voice, 'cangyuan');
    assert.ok(sample, `${voice} should have a local sample mapping`);
    const absolutePath = path.join(process.cwd(), 'public', sample.url.replace(/^\//u, ''));
    assert.equal(existsSync(absolutePath), true, `${absolutePath} should exist`);
    assert.ok(statSync(absolutePath).size > 44, `${absolutePath} should contain audio data`);
  }
});

test('MiniMax HD and Turbo share exact official voice references without pretending to be model-generated', () => {
  const catalog = createTsRequire(process.cwd())('./packages/contracts/cangyuan-minimax-voices');
  assert.equal(catalog.CANGYUAN_MINIMAX_VOICES.length, 327);
  for (const voice of catalog.CANGYUAN_MINIMAX_VOICES) {
    const hd = samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', voice.voiceId, 'cangyuan');
    const turbo = samples.getSpeechVoiceSample('minimax-speech-2.8-turbo-tts', voice.voiceId, 'cangyuan');
    assert.ok(hd, `${voice.voiceId} should have an official reference`);
    assert.equal(hd, turbo);
    assert.equal(hd.url, voice.previewUrl);
    assert.equal(hd.provenance.source, 'official-reference');
    assert.equal(hd.provenance.voiceId, voice.voiceId);
    assert.equal(hd.provenance.generatedAt, undefined);
    assert.equal(hd.provenance.responseModelId, undefined);
    assert.equal(hd.text, '');
    assert.equal(samples.getSpeechVoiceSample('gemini-tts', voice.voiceId, 'cangyuan'), null);
    assert.equal(samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', voice.voiceId, 'other-provider'), null);
  }
});

test('all legacy MiniMax IDs share only their exact same-name same-language official reference', () => {
  const voices = createTsRequire(process.cwd())('./packages/contracts/minimax-system-voices');
  const official = voices.getMiniMaxSystemVoices('cangyuan');
  for (const legacy of voices.MINIMAX_SYSTEM_VOICES) {
    const exact = official.filter((voice) => voice.originalName === legacy.name && voice.languageLabel === legacy.languageLabel);
    assert.equal(exact.length, 1);
    for (const model of ['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']) {
      const sample = samples.getSpeechVoiceSample(model, legacy.voiceId, 'cangyuan');
      assert.equal(sample, samples.getSpeechVoiceSample(model, exact[0].voiceId, 'cangyuan'));
      assert.equal(sample.provenance.voiceId, exact[0].voiceId);
      assert.ok(sample.url.endsWith(`${exact[0].voiceId}.mp3`));
      assert.equal(samples.getSpeechVoiceSample(model, legacy.voiceId, 'other-provider'), null);
    }
  }
  assert.notEqual(samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', 'male-qn-qingse', 'cangyuan'), samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', 'male-qn-qingse-jingpin', 'cangyuan'));
  for (const id of ['Santa Claus', 'unknown', 'private-clone-voice', `voice_builtin_${'0'.repeat(64)}`]) {
    assert.equal(samples.getSpeechVoiceSample('minimax-speech-2.8-hd-tts', id, 'cangyuan'), null);
  }
});

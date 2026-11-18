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

import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const samples = createTsRequire(process.cwd())('./components/audio/voice-samples');

test('available speech voice samples map to local audio without changing provider IDs', () => {
  for (const model of ['gemini-tts', 'mu1-muse-tts']) {
    const profile = contracts.getSpeechModelProfile(model);
    for (const voice of profile.suggestedVoices) {
      const sample = samples.getSpeechVoiceSample(model, voice);
      if (!sample) continue;
      const relativePath = sample.url.replace(/^\//u, '').replaceAll('/', '\\');
      const absolutePath = `${process.cwd()}\\public\\${relativePath}`;
      assert.equal(existsSync(absolutePath), true, `${absolutePath} should exist`);
      assert.ok(statSync(absolutePath).size > 44, `${absolutePath} should contain audio data`);
    }
  }
  assert.equal(samples.getSpeechVoiceSample('mu1-muse-tts', 'sage'), null);
});

test('unknown and custom voices do not fall back to a billable preview endpoint', () => {
  assert.equal(samples.getSpeechVoiceSample('unknown-model', 'voice-a'), null);
  assert.equal(samples.getSpeechVoiceSample('gemini-tts', 'custom-voice'), null);
});

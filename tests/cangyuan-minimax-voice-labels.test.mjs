import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { cangyuanMiniMaxVoiceLabel } = createTsRequire(process.cwd())('./packages/contracts/cangyuan-minimax-voice-labels');

test('MiniMax official display names have accurate Chinese translations without changing original catalog names', () => {
  assert.equal(cangyuanMiniMaxVoiceLabel('Diligent Man'), '勤奋男性');
  assert.equal(cangyuanMiniMaxVoiceLabel('Diligent_Man'), '勤奋男性');
  assert.equal(cangyuanMiniMaxVoiceLabel('Calm Woman'), '沉静女性');
  assert.equal(cangyuanMiniMaxVoiceLabel('Patient Female Presenter'), '耐心女主持');
  assert.equal(cangyuanMiniMaxVoiceLabel('Intellectual Senior'), '知性前辈');
  assert.equal(cangyuanMiniMaxVoiceLabel('Wise Scholar'), '睿智学者');
  assert.equal(cangyuanMiniMaxVoiceLabel('Arnold'), '阿诺德');
  assert.equal(cangyuanMiniMaxVoiceLabel('青涩青年音色-beta'), '青涩青年音色（测试版）');
  assert.equal(cangyuanMiniMaxVoiceLabel('柔和少女'), '柔和少女');
  assert.equal(cangyuanMiniMaxVoiceLabel('unknown-new-name'), 'unknown-new-name');
});

test('every documented MiniMax voice displays a Chinese name while request IDs stay untouched', () => {
  const voices = JSON.parse(readFileSync(path.join(process.cwd(), 'packages/contracts/cangyuan-minimax-voices.json'), 'utf8'));
  assert.equal(voices.length, 327);
  for (const voice of voices) {
    const requestId = voice.voiceId;
    const label = cangyuanMiniMaxVoiceLabel(voice.name);
    assert.match(label, /[\p{Script=Han}]/u, `${voice.name} should have a Chinese display name`);
    assert.doesNotMatch(label, /[A-Za-z]/u, `${voice.name} should not leave untranslated English`);
    assert.equal(voice.voiceId, requestId);
  }
});

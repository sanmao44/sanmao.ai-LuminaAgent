import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const voiceOptions = createTsRequire(process.cwd())('./components/cangyuan/speech-voice-options');

test('Gemini TTS displays Chinese voice names while preserving documented request IDs', () => {
  const profile = contracts.getCangyuanSpeechModelProfile('gemini-tts');
  const options = voiceOptions.cangyuanSpeechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), ['五车二', '大熊', '织女星', '日蚀', '天琴', '轨道', '北斗', '新星', '飞马']);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

test('Muse TTS labels explain documented voice groups without changing request IDs', () => {
  const profile = contracts.getCangyuanSpeechModelProfile('mu1-muse-tts');
  const options = voiceOptions.cangyuanSpeechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '合金（清亮女声）', '咏叹调（清亮女声）', '珊瑚（清亮女声）',
    '新星（温暖女声）', '微光（温暖女声）', '智者（温暖女声）',
    '回声（沉稳男声）', '赫利俄斯（沉稳男声）', '缟玛瑙（沉稳男声）',
    '寓言（叙事男声）',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

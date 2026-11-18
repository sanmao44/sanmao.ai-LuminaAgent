import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const voiceOptions = createTsRequire(process.cwd())('./components/audio/voice-options');

test('Gemini TTS displays Chinese voice names while preserving documented request IDs', () => {
  const profile = contracts.getSpeechModelProfile('gemini-tts');
  const options = voiceOptions.speechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), ['五车二', '厄尔萨', '织女星', '伊克利普斯', '天琴座', '奥比特', '迪珀', '诺娃', '佩伽索斯']);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

test('Muse TTS labels explain documented voice groups without changing request IDs', () => {
  const profile = contracts.getSpeechModelProfile('mu1-muse-tts');
  const options = voiceOptions.speechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '艾洛伊（清亮女声）', '阿丽娅（清亮女声）', '科拉尔（清亮女声）',
    '诺娃（温暖女声）', '希默（温暖女声）', '赛奇（温暖女声）',
    '艾可（沉稳男声）', '赫利欧（沉稳男声）', '奥尼克斯（沉稳男声）',
    '费布尔（叙事男声）',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

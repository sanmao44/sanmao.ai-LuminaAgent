import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const voiceOptions = createTsRequire(process.cwd())('./components/audio/voice-options');

test('Gemini TTS displays Chinese voice names while preserving documented request IDs', () => {
  const profile = contracts.getSpeechModelProfile('gemini-tts');
  const options = voiceOptions.speechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '五车二', '乌尔萨', '织女星', '日食', '天琴座', '轨道', '北斗七星', '新星', '飞马座',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

test('Muse TTS labels explain documented voice groups without changing request IDs', () => {
  const profile = contracts.getSpeechModelProfile('mu1-muse-tts');
  const options = voiceOptions.speechVoiceOptions(profile);

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '艾洛伊（清亮女声）', '阿丽娅（清亮女声）', '科拉尔（清亮女声）',
    '诺娃（温暖女声）', '希默尔（温暖女声）', '塞奇（温暖女声）',
    '埃科（沉稳男声）', '赫利奥（沉稳男声）', '奥尼克斯（沉稳男声）', '费布尔（叙事男声）',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
  assert.equal(options.find(({ value }) => value === 'sage')?.description, '该音色暂无样音');
  assert.equal(options.find(({ value }) => value === 'alloy')?.description, '可播放本地样音，不消耗额度');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contracts = createTsRequire(process.cwd())('./packages/contracts/audio-synthesis');
const voiceOptions = createTsRequire(process.cwd())('./components/audio/voice-options');

test('Gemini TTS displays Chinese voice names while preserving documented request IDs', () => {
  const profile = contracts.getSpeechModelProfile('gemini-tts', 'cangyuan');
  const options = voiceOptions.speechVoiceOptions(profile, 'cangyuan');

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '五车二', '乌尔萨', '织女星', '日食', '天琴座', '轨道', '北斗七星', '新星', '飞马座',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
});

test('Muse TTS labels explain documented voice groups without changing request IDs', () => {
  const profile = contracts.getSpeechModelProfile('mu1-muse-tts', 'cangyuan');
  const options = voiceOptions.speechVoiceOptions(profile, 'cangyuan');

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '艾洛伊（清亮女声）', '阿丽娅（清亮女声）', '科拉尔（清亮女声）',
    '诺娃（温暖女声）', '希默尔（温暖女声）', '塞奇（温暖女声）',
    '埃科（沉稳男声）', '赫利奥（沉稳男声）', '奥尼克斯（沉稳男声）', '费布尔（叙事男声）',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
  assert.equal(options.find(({ value }) => value === 'sage')?.description, '对应音色样音待生成');
  assert.equal(options.find(({ value }) => value === 'alloy')?.description, '可播放本地样音，不消耗额度');
});

test('ElevenLabs v4 translates each documented preset voice while preserving provider IDs', () => {
  const profile = contracts.getSpeechModelProfile('elevenlabs-v4-tts', 'cangyuan');
  const options = voiceOptions.speechVoiceOptions(profile, 'cangyuan');

  assert.deepEqual(options.map(({ value }) => value), profile.suggestedVoices);
  assert.deepEqual(options.map(({ label }) => label), [
    '瑞秋', '阿莉娅', '罗杰', '莎拉', '劳拉', '查理', '乔治', '卡勒姆', '里弗', '利亚姆', '夏洛特',
    '爱丽丝', '玛蒂尔达', '威尔', '杰西卡', '埃里克', '克里斯', '布莱恩', '丹尼尔', '莉莉', '比尔',
  ]);
  assert.ok(options.every(({ label }) => !/[A-Za-z]/.test(label)));
  assert.ok(options.every(({ description }) => description === '可播放本地样音，不消耗额度'));
  assert.equal(contracts.speechVoiceLabel('external-voice-id', 'elevenlabs-v4-tts'), '自定义音色');
});

test('voice options do not advertise Cangyuan samples for another provider', () => {
  const profile = contracts.getSpeechModelProfile('gemini-tts', 'cangyuan');
  const options = voiceOptions.speechVoiceOptions(profile, 'other-provider');

  assert.ok(options.every(({ description }) => description === '对应音色样音待生成'));
});

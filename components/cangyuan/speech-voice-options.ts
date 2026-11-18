import type { CangyuanSpeechModelProfile } from '@/packages/contracts/audio-synthesis';
import { cangyuanSpeechVoiceLabel } from '@/packages/contracts/audio-synthesis';

const VOICE_CHARACTERISTICS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'mu1-muse-tts': Object.freeze({
    alloy: '清亮女声', aria: '清亮女声', coral: '清亮女声',
    nova: '温暖女声', shimmer: '温暖女声', sage: '温暖女声',
    echo: '沉稳男声', helio: '沉稳男声', onyx: '沉稳男声', fable: '叙事男声',
  }),
});

export function cangyuanSpeechVoiceOptions(profile: CangyuanSpeechModelProfile) {
  const characteristics = VOICE_CHARACTERISTICS[profile.publicModel] || {};
  return profile.suggestedVoices.map((voice) => ({
    value: voice,
    label: characteristics[voice]
      ? `${cangyuanSpeechVoiceLabel(voice)}（${characteristics[voice]}）`
      : cangyuanSpeechVoiceLabel(voice),
  }));
}

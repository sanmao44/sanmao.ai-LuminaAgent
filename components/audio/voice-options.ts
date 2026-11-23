import type { SpeechModelProfile } from '@/packages/contracts/audio-synthesis';
import { speechVoiceLabel } from '@/packages/contracts/audio-synthesis';
import { getSpeechVoiceSample } from './voice-samples';

export function speechVoiceOptions(profile: SpeechModelProfile, providerKey: string) {
  return profile.suggestedVoices.map((voice) => {
    const hasSample = Boolean(getSpeechVoiceSample(profile.publicModel, voice, providerKey));
    return {
      value: voice,
      label: speechVoiceLabel(voice, profile.publicModel),
      description: hasSample ? '可播放本地样音，不消耗额度' : '对应音色样音待生成',
    };
  });
}

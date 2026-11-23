import sampleManifest from './voice-samples.manifest.json';
import { CANGYUAN_MINIMAX_VOICES, CANGYUAN_MINIMAX_VOICE_SOURCE } from '@/packages/contracts/cangyuan-minimax-voices';

type VoiceSampleAudio = {
  url: string;
  text: string;
  note: string;
};

type GeneratedVoiceSample = VoiceSampleAudio & {
  provenance: {
    provider: string;
    providerKey: string;
    modelId: string;
    voiceId: string;
    routeModelId: string;
    responseModelId: string;
    generatedAt: string;
    contentType: string;
    bytes: number;
    sha256: string;
    requestOptions?: Readonly<Record<string, string | number>>;
  };
};

type OfficialVoiceSample = VoiceSampleAudio & {
  provenance: {
    source: 'official-reference';
    providerKey: string;
    voiceId: string;
    supportedModels: readonly string[];
    sourceUrl: string;
    contentType: string;
  };
};

export type SpeechVoiceSample = GeneratedVoiceSample | OfficialVoiceSample;

export const SAMPLE_TEXT = '你好，这是一段音色试听。';

const VERIFIED_PROVIDER_KEY = 'cangyuan';
const SPEECH_VOICE_SAMPLES = sampleManifest as Readonly<Record<string, Readonly<Record<string, GeneratedVoiceSample>>>>;
const MINIMAX_REFERENCE_MODELS = Object.freeze(['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']);
const OFFICIAL_MINIMAX_SAMPLES = new Map<string, OfficialVoiceSample>(CANGYUAN_MINIMAX_VOICES.map((voice) => [voice.voiceId, {
  url: voice.previewUrl,
  text: '',
  note: '官方音色参考样音，高保真与快速共用；实际效果随模型和设置变化',
  provenance: {
    source: 'official-reference',
    providerKey: VERIFIED_PROVIDER_KEY,
    voiceId: voice.voiceId,
    supportedModels: MINIMAX_REFERENCE_MODELS,
    sourceUrl: CANGYUAN_MINIMAX_VOICE_SOURCE,
    contentType: 'audio/mpeg',
  },
}]));

export function getSpeechVoiceSample(publicModel: string, voice: string, providerKey: string): SpeechVoiceSample | null {
  if (String(providerKey || '') !== VERIFIED_PROVIDER_KEY) return null;
  if (MINIMAX_REFERENCE_MODELS.includes(publicModel)) {
    const official = OFFICIAL_MINIMAX_SAMPLES.get(voice);
    if (official) return official;
  }
  return SPEECH_VOICE_SAMPLES[String(publicModel || '')]?.[String(voice || '')] || null;
}

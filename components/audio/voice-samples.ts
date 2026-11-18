import sampleManifest from './voice-samples.manifest.json';

export type SpeechVoiceSample = {
  url: string;
  text: string;
  note: string;
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

export const SAMPLE_TEXT = '你好，这是一段音色试听。';

const VERIFIED_PROVIDER_KEY = 'cangyuan';
const SPEECH_VOICE_SAMPLES = sampleManifest as Readonly<Record<string, Readonly<Record<string, SpeechVoiceSample>>>>;

export function getSpeechVoiceSample(publicModel: string, voice: string, providerKey: string): SpeechVoiceSample | null {
  if (String(providerKey || '') !== VERIFIED_PROVIDER_KEY) return null;
  return SPEECH_VOICE_SAMPLES[String(publicModel || '')]?.[String(voice || '')] || null;
}

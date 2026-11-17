/** Synchronous speech generation used by interactive audio creation surfaces. */
export const CANGYUAN_SPEECH_OUTPUT_FORMATS = Object.freeze([
  'mp3',
  'wav',
  'opus',
  'aac',
  'flac',
  'pcm',
] as const);

export type SpeechOutputFormat = typeof CANGYUAN_SPEECH_OUTPUT_FORMATS[number];

export type CangyuanSpeechModelProfile = {
  publicModel: string;
  suggestedVoices: readonly string[];
  responseFormats: readonly SpeechOutputFormat[];
  speedRange?: { min: number; max: number };
};

const CANGYUAN_SPEECH_PROFILES: Readonly<Record<string, CangyuanSpeechModelProfile>> = Object.freeze({
  'gemini-tts': Object.freeze({
    publicModel: 'gemini-tts',
    suggestedVoices: Object.freeze(['Capella', 'Ursa', 'Vega', 'Eclipse', 'Lyra', 'Orbit', 'Dipper', 'Nova', 'Pegasus'] as const),
    responseFormats: Object.freeze(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const),
    speedRange: Object.freeze({ min: 0.25, max: 4 }),
  }),
  'mu1-muse-tts': Object.freeze({
    publicModel: 'mu1-muse-tts',
    suggestedVoices: Object.freeze(['alloy', 'aria', 'coral', 'nova', 'shimmer', 'sage', 'echo', 'helio', 'onyx', 'fable'] as const),
    responseFormats: Object.freeze(['mp3', 'wav', 'opus', 'pcm'] as const),
  }),
});

export function getCangyuanSpeechModelProfile(publicModel: string): CangyuanSpeechModelProfile | null {
  return CANGYUAN_SPEECH_PROFILES[String(publicModel || '')] || null;
}

export type AudioSynthesisRequest = {
  text: string;
  voice?: string;
  format?: SpeechOutputFormat;
  speed?: number;
  modelId?: string;
  source?: 'workspace' | 'agent' | 'canvas';
  projectId?: string;
  canvasId?: string;
  nodeId?: string;
};

export type AudioSynthesisResult = {
  data: Uint8Array;
  contentType: string;
  extension: string;
  engine: 'provider' | 'offline';
  modelName?: string;
  modelId?: string;
};

export interface AudioSynthesisPort {
  synthesize(input: AudioSynthesisRequest, signal?: AbortSignal): Promise<AudioSynthesisResult>;
}

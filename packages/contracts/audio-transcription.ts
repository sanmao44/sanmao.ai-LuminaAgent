export const AUDIO_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze([
  'json',
  'text',
  'verbose_json',
] as const);

export type AudioTranscriptionResponseFormat = typeof AUDIO_TRANSCRIPTION_RESPONSE_FORMATS[number];

export type AudioTranscriptionModelSelection = {
  source: 'local';
} | {
  source: 'moark';
  modelId: 'SenseVoiceSmall';
} | {
  source: 'provider';
  modelId: string;
} | {
  /** Accepted for compatibility with older direct transcription callers. */
  source?: undefined;
  modelId: string;
};

export const LOCAL_AUDIO_TRANSCRIPTION_MODEL_ID = 'local-whisper';
export const MOARK_AUDIO_TRANSCRIPTION_MODEL_ID = 'moark-sensevoice-small';

export function audioTranscriptionSelectionForChoice(modelId: string): AudioTranscriptionModelSelection {
  if (modelId === LOCAL_AUDIO_TRANSCRIPTION_MODEL_ID) return { source: 'local' };
  if (modelId === MOARK_AUDIO_TRANSCRIPTION_MODEL_ID) return { source: 'moark', modelId: 'SenseVoiceSmall' };
  return { source: 'provider', modelId };
}

export function parseAudioTranscriptionModelSelection(value: unknown): AudioTranscriptionModelSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selection = value as Record<string, unknown>;
  if (selection.source === 'local') return { source: 'local' };
  if (selection.source === 'moark' && selection.modelId === 'SenseVoiceSmall') {
    return { source: 'moark', modelId: 'SenseVoiceSmall' };
  }
  if (selection.source === 'provider' && typeof selection.modelId === 'string') {
    const modelId = selection.modelId.trim();
    return modelId && modelId.length <= 240 ? { source: 'provider', modelId } : null;
  }
  // Older clients sent only { modelId } for a registered ASR model.
  if (selection.source === undefined && typeof selection.modelId === 'string') {
    const modelId = selection.modelId.trim();
    if (!modelId || modelId.length > 240) return null;
    return audioTranscriptionSelectionForChoice(modelId);
  }
  return null;
}

export type AudioTranscriptionRequest = {
  modelId: string;
  file: { name: string; mimeType: string; bytes: Uint8Array };
  language?: string;
  prompt?: string;
  responseFormat?: string;
  temperature?: number;
};

export type AudioTranscriptionResult = {
  text: string;
  modelId: string;
  modelName: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  responseFormat: string;
  temperature: number;
  historyError?: string;
};

export type AudioTranscriptionPort = {
  transcribe(input: AudioTranscriptionRequest, signal?: AbortSignal): Promise<Omit<AudioTranscriptionResult, 'responseFormat' | 'temperature'>>;
};

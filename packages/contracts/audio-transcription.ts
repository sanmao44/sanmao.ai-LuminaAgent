export const AUDIO_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze([
  'json',
  'text',
  'verbose_json',
] as const);

export type AudioTranscriptionResponseFormat = typeof AUDIO_TRANSCRIPTION_RESPONSE_FORMATS[number];

export type AudioTranscriptionModelSelection = {
  modelId: string;
};

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

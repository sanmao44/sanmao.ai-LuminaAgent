export const SPEECH_VOICE_REGISTRATION_MODELS = Object.freeze([
  'voice-clone-tts',
  'minimax-speech-2.8-hd-clone',
  'minimax-speech-2.8-turbo-clone',
] as const);

export type SpeechVoiceRegistrationModel = typeof SPEECH_VOICE_REGISTRATION_MODELS[number];

export type SpeechVoiceRecord = {
  voiceId: string;
  name: string;
  status: string;
  previewUrl?: string;
};

export type SpeechVoiceRegistrationInput = {
  modelId: string;
  registrationModel: SpeechVoiceRegistrationModel;
  name: string;
  url: string;
  consent: true;
};

export type SpeechVoiceListInput = Pick<SpeechVoiceRegistrationInput, 'modelId' | 'registrationModel'>;

export type SpeechVoicePreviewInput = SpeechVoiceListInput & {
  previewUrl: string;
};

export type SpeechVoicePreviewResult = {
  body: ArrayBuffer;
  contentType: string;
};

export type SpeechVoiceRegistryPort = {
  register(input: SpeechVoiceRegistrationInput, signal?: AbortSignal): Promise<SpeechVoiceRecord>;
  list(input: SpeechVoiceListInput, signal?: AbortSignal): Promise<readonly SpeechVoiceRecord[]>;
  preview(input: SpeechVoicePreviewInput, signal?: AbortSignal): Promise<SpeechVoicePreviewResult>;
};

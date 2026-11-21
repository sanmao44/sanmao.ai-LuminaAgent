import type { SpeechVoiceListInput, SpeechVoicePreviewInput, SpeechVoiceRegistryPort, SpeechVoiceRegistrationInput } from '@/packages/contracts/audio-voice-registration';
import { listSpeechVoices, previewSpeechVoice, registerSpeechVoice, SpeechVoiceProviderError, SpeechVoiceRegistrationUnavailableError } from './audio-voice-registration-application';
import { isCangyuanProvider } from '@/lib/cangyuan-provider';
import { resolveSpeechRuntime } from '@/lib/clone/speech';
import { CangyuanSpeechVoiceError, listCangyuanSpeechVoices, previewCangyuanSpeechVoice, registerCangyuanSpeechVoice } from '@/lib/clone/voice-registration';

const REGISTRATION_TARGET_MODELS: Readonly<Record<SpeechVoiceRegistrationInput['registrationModel'], readonly string[]>> = Object.freeze({
  'voice-clone-tts': Object.freeze(['voice-clone-tts']),
  'minimax-speech-2.8-hd-clone': Object.freeze(['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']),
  'minimax-speech-2.8-turbo-clone': Object.freeze(['minimax-speech-2.8-hd-tts', 'minimax-speech-2.8-turbo-tts']),
});

async function runtimeFor(input: SpeechVoiceRegistrationInput | SpeechVoiceListInput | SpeechVoicePreviewInput) {
  const runtime = await resolveSpeechRuntime(input.modelId);
  const rawModel = runtime?.model.rawId.toLowerCase().split('/').at(-1)?.split(':').at(-1);
  if (!runtime || runtime.model.id !== input.modelId || !runtime.model.capabilities.includes('speech')
    || !isCangyuanProvider(runtime.provider) || !rawModel
    || !REGISTRATION_TARGET_MODELS[input.registrationModel].includes(rawModel)) {
    throw new SpeechVoiceRegistrationUnavailableError('所选配音模型与声音克隆型号不匹配，或该服务商未提供声音克隆登记。');
  }
  return runtime;
}

const speechVoiceRegistryPort: SpeechVoiceRegistryPort = {
  async register(input, signal) {
    const runtime = await runtimeFor(input);
    try {
      return await registerCangyuanSpeechVoice(runtime, input, signal);
    } catch (error) {
      if (error instanceof CangyuanSpeechVoiceError) throw new SpeechVoiceProviderError(error.message, error.resultUnconfirmed);
      throw error;
    }
  },
  async list(input, signal) {
    const runtime = await runtimeFor(input);
    try {
      return await listCangyuanSpeechVoices(runtime, input, signal);
    } catch (error) {
      if (error instanceof CangyuanSpeechVoiceError) throw new SpeechVoiceProviderError(error.message, error.resultUnconfirmed);
      throw error;
    }
  },
  async preview(input, signal) {
    const runtime = await runtimeFor(input);
    try {
      return await previewCangyuanSpeechVoice(runtime, input.previewUrl, signal);
    } catch (error) {
      if (error instanceof CangyuanSpeechVoiceError) throw new SpeechVoiceProviderError(error.message, error.resultUnconfirmed);
      throw error;
    }
  },
};

export function registerConfiguredSpeechVoice(input: unknown, signal?: AbortSignal) {
  return registerSpeechVoice(input, speechVoiceRegistryPort, signal);
}

export function listConfiguredSpeechVoices(input: unknown, signal?: AbortSignal) {
  return listSpeechVoices(input, speechVoiceRegistryPort, signal);
}

export function previewConfiguredSpeechVoice(input: unknown, signal?: AbortSignal) {
  return previewSpeechVoice(input, speechVoiceRegistryPort, signal);
}

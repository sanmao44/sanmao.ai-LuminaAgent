import type { AudioArtifactPersistencePort, AudioSynthesisPort } from '@/packages/contracts/audio-synthesis';
import { offlineSpeechSupported, synthesizeOfflineSpeech } from '@/lib/clone/offline-speech';
import { audioExtension, resolveSpeechRuntime, synthesizeSpeech } from '@/lib/clone/speech';
import { persistAudioBuffer } from '@/lib/audio-storage';
import { AudioSynthesisUnavailableError, synthesizeAndPersistAudio, synthesizeAudioRequest } from './audio-synthesis-application';

const audioSynthesisPort: AudioSynthesisPort = {
  async synthesize(input, signal) {
    const selectedModelId = input.modelId || null;
    const runtime = await resolveSpeechRuntime(selectedModelId);
    if (selectedModelId && (
      !runtime
      || runtime.model.id !== selectedModelId
      || !runtime.model.capabilities.includes('speech')
    )) {
      throw new AudioSynthesisUnavailableError('所选配音模型当前不可用或不支持配音，请重新选择。');
    }
    if (runtime) {
      const audio = await synthesizeSpeech(runtime, {
        text: input.text,
        ...(input.voice ? { voice: input.voice } : {}),
        ...(input.format ? { format: input.format } : {}),
        ...(input.speed !== undefined ? { speed: input.speed } : {}),
        signal,
      });
      return {
        data: audio.buffer,
        contentType: audio.contentType,
        extension: audioExtension(audio.contentType),
        engine: 'provider',
        modelName: runtime.model.displayName,
        modelId: runtime.model.id,
      };
    }
    if (offlineSpeechSupported()) {
      const audio = await synthesizeOfflineSpeech(input.text, input.voice ? { voice: input.voice } : {});
      return {
        data: audio.buffer,
        contentType: audio.contentType,
        extension: audioExtension(audio.contentType),
        engine: 'offline',
      };
    }
    throw new AudioSynthesisUnavailableError();
  },
};

const audioArtifactPersistence: AudioArtifactPersistencePort = {
  async persist(data, contentType) {
    const stored = await persistAudioBuffer(Buffer.from(data), contentType);
    return { url: stored.url };
  },
};

export function synthesizeCanvasNarration(input: unknown, signal?: AbortSignal) {
  return synthesizeAndPersistAudio(input, audioSynthesisPort, audioArtifactPersistence, signal);
}

export function synthesizeSpeechPreview(input: unknown, signal?: AbortSignal) {
  return synthesizeAudioRequest(input, audioSynthesisPort, signal);
}

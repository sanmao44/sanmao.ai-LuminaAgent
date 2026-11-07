import type { AudioSynthesisPort } from '@/packages/contracts/audio-synthesis';
import { offlineSpeechSupported, synthesizeOfflineSpeech } from '@/lib/clone/offline-speech';
import { audioExtension, resolveSpeechRuntime, synthesizeSpeech } from '@/lib/clone/speech';
import { AudioSynthesisUnavailableError, synthesizeAudioRequest } from './audio-synthesis-application';

const audioSynthesisPort: AudioSynthesisPort = {
  async synthesize(input, signal) {
    const runtime = await resolveSpeechRuntime();
    if (runtime) {
      const audio = await synthesizeSpeech(runtime, {
        text: input.text,
        ...(input.voice ? { voice: input.voice } : {}),
        signal,
      });
      return {
        data: audio.buffer,
        contentType: audio.contentType,
        extension: audioExtension(audio.contentType),
        engine: 'provider',
        modelName: runtime.model.displayName,
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

export function synthesizeCanvasNarration(input: unknown, signal?: AbortSignal) {
  return synthesizeAudioRequest(input, audioSynthesisPort, signal);
}

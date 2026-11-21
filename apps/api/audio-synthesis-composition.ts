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
        ...(input.applyTextNormalization ? { applyTextNormalization: input.applyTextNormalization } : {}),
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.languageCode ? { languageCode: input.languageCode } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(input.similarityBoost !== undefined ? { similarityBoost: input.similarityBoost } : {}),
        ...(input.stability !== undefined ? { stability: input.stability } : {}),
        ...(input.voiceId ? { voiceId: input.voiceId } : {}),
        ...(input.emotion ? { emotion: input.emotion } : {}),
        ...(input.instruct ? { instruct: input.instruct } : {}),
        ...(input.dialogue?.length ? { dialogue: input.dialogue } : {}),
        ...(input.aigcWatermark !== undefined ? { aigcWatermark: input.aigcWatermark } : {}),
        ...(input.bitrate ? { bitrate: input.bitrate } : {}),
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.effectIntensity !== undefined ? { effectIntensity: input.effectIntensity } : {}),
        ...(input.effectPitch !== undefined ? { effectPitch: input.effectPitch } : {}),
        ...(input.effectTimbre !== undefined ? { effectTimbre: input.effectTimbre } : {}),
        ...(input.latexRead !== undefined ? { latexRead: input.latexRead } : {}),
        ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
        ...(input.pronunciationTone ? { pronunciationTone: input.pronunciationTone } : {}),
        ...(input.sampleRate ? { sampleRate: input.sampleRate } : {}),
        ...(input.soundEffects ? { soundEffects: input.soundEffects } : {}),
        ...(input.textNormalizationMode ? { textNormalizationMode: input.textNormalizationMode } : {}),
        ...(input.volume !== undefined ? { volume: input.volume } : {}),
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

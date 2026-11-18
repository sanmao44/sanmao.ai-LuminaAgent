import type { AudioTranscriptionApplicationPorts } from './audio-transcription-application';
import { transcribeUploadedAudio, AudioTranscriptionInputError } from './audio-transcription-application';
import { transcribeOpenAiCompatibleAudio } from '@/lib/audio-transcription-provider';
import { getRuntimeModelCandidates } from '@/lib/store';
import { startGenerationLog, finishGenerationLog } from '@/lib/generation-log';
import type { AudioTranscriptionRequest } from '@/packages/contracts/audio-transcription';

const ports: AudioTranscriptionApplicationPorts = {
  async transcribe(input: AudioTranscriptionRequest, signal) {
    const candidates = await getRuntimeModelCandidates(input.modelId, 'audio');
    const runtime = candidates.find((candidate) => candidate.model.id === input.modelId
      && candidate.model.capabilities.includes('transcription'));
    if (!runtime) throw new AudioTranscriptionInputError('所选模型不可用或不支持音频转写，请在模型库检查其分类和能力。');
    return transcribeOpenAiCompatibleAudio(runtime, input, signal);
  },
  startLog: (input) => startGenerationLog(input),
  finishLog: (id, patch) => finishGenerationLog(id, patch),
};

export function transcribeAudio(input: unknown, signal?: AbortSignal) {
  return transcribeUploadedAudio(input, ports, signal);
}

import type { AutomaticSpeechRecognitionOutput } from '@huggingface/transformers';
import {
  groupTranscriptWords as groupSharedTranscriptWords,
  normalizeLocalAsrResult as normalizeSharedAsrResult,
  transcribeLocalPcmWav,
} from '../transcription/local-whisper';
import { extractSpeechAudio } from './media';
import type { CloneTranscript, CloneTranscriptSegment, CloneTranscriptWord } from './types';

export const DEFAULT_CLONE_ASR_MODEL = 'Xenova/whisper-tiny';

/** Preserve the Clone API while sharing the timestamp grouping implementation. */
export function groupTranscriptWords(words: readonly CloneTranscriptWord[], maxSegmentSeconds = 5): CloneTranscriptSegment[] {
  return groupSharedTranscriptWords(words, maxSegmentSeconds);
}

/** Preserve Clone's normalization export for existing callers. */
export function normalizeLocalAsrResult(
  raw: AutomaticSpeechRecognitionOutput,
  durationSeconds: number,
  model: string,
  language?: string,
): CloneTranscript {
  return normalizeSharedAsrResult(raw, durationSeconds, model, language);
}

export async function transcribeLocalAudio(file: string, durationSeconds: number): Promise<CloneTranscript> {
  const model = String(process.env.SANMAO_CLONE_ASR_MODEL || DEFAULT_CLONE_ASR_MODEL).trim() || DEFAULT_CLONE_ASR_MODEL;
  const language = String(process.env.SANMAO_CLONE_ASR_LANGUAGE || '').trim() || undefined;
  return transcribeLocalPcmWav(file, durationSeconds, {
    model,
    language,
    localOnly: process.env.SANMAO_CLONE_ASR_LOCAL_ONLY === '1',
  });
}

export async function transcribeReferenceAudio(input: string, output: string, durationSeconds: number) {
  const extracted = await extractSpeechAudio(input, output);
  if (!extracted) return { transcript: null, error: '参考素材没有可用音轨或音轨转换失败' };
  try {
    const transcript = await transcribeLocalAudio(extracted, durationSeconds);
    return { transcript: transcript.text ? transcript : null, error: '' };
  } catch (error) {
    return { transcript: null, error: error instanceof Error ? error.message : '本地 ASR 失败' };
  }
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutomaticSpeechRecognitionOutput } from '@huggingface/transformers';
import { resolveLocalDataDir } from '../data-paths';
import { extractSpeechAudio } from './media';
import type { CloneTranscript, CloneTranscriptSegment, CloneTranscriptWord } from './types';

export const DEFAULT_CLONE_ASR_MODEL = 'Xenova/whisper-tiny';
const MAX_TRANSCRIPT_WORDS = 4_000;
const MAX_TRANSCRIPT_SEGMENTS = 1_000;

type RawChunk = {
  text?: unknown;
  timestamp?: unknown;
};

type LocalTranscriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<AutomaticSpeechRecognitionOutput>;

let transcriberPromise: Promise<LocalTranscriber> | null = null;

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function timestampPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const start = Math.max(0, finite(value[0], NaN));
  const end = finite(value[1], NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return [round3(start), round3(Math.max(start, end))];
}

function readPcm16Wav(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('本地 ASR 收到的音频不是 WAV 文件');
  }
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + size <= buffer.length) {
      const format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
      if (format !== 1) throw new Error('本地 ASR 只支持 PCM WAV');
    }
    if (id === 'data') {
      dataStart = body;
      dataLength = Math.min(size, buffer.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (channels !== 1 || sampleRate !== 16_000 || bitsPerSample !== 16 || dataStart < 0 || dataLength < 2) {
    throw new Error('本地 ASR 音频格式异常：需要单声道 16 kHz PCM');
  }
  const samples = new Float32Array(Math.floor(dataLength / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(dataStart + index * 2) / 32_768;
  return samples;
}

function normalizeWords(chunks: readonly RawChunk[], durationSeconds: number): CloneTranscriptWord[] {
  const words: CloneTranscriptWord[] = [];
  for (const chunk of chunks.slice(0, MAX_TRANSCRIPT_WORDS)) {
    const text = cleanText(chunk.text);
    const pair = timestampPair(chunk.timestamp);
    if (!text || !pair) continue;
    const start = round3(Math.min(Math.max(0, pair[0]), durationSeconds));
    const end = round3(Math.min(Math.max(start, pair[1]), durationSeconds));
    if (end <= start) continue;
    words.push({ start, end: Math.max(start, end), text });
  }
  return words;
}

function endsSentence(text: string) {
  return /[。！？.!?；;]$/u.test(text);
}

/** Convert Whisper's timestamped chunks into stable caption-sized segments. */
export function groupTranscriptWords(words: readonly CloneTranscriptWord[], maxSegmentSeconds = 5) {
  const segments: CloneTranscriptSegment[] = [];
  let current: CloneTranscriptSegment | null = null;
  for (const word of words) {
    if (!current) {
      current = { start: word.start, end: word.end, text: word.text, words: [word] };
      continue;
    }
    const gap = Math.max(0, word.start - current.end);
    const longEnough = word.end - current.start >= maxSegmentSeconds;
    if (endsSentence(current.text) || gap > 1.2 || longEnough) {
      segments.push(current);
      current = { start: word.start, end: word.end, text: word.text, words: [word] };
      continue;
    }
    current.end = word.end;
    current.text = `${current.text}${/^[，。！？、,.!?;；:：]/u.test(word.text) ? '' : ' '}${word.text}`.trim();
    current.words?.push(word);
  }
  if (current) segments.push(current);
  return segments.slice(0, MAX_TRANSCRIPT_SEGMENTS).map((segment) => ({
    ...segment,
    start: round3(segment.start),
    end: round3(segment.end),
    text: cleanText(segment.text),
  }));
}

export function normalizeLocalAsrResult(raw: AutomaticSpeechRecognitionOutput, durationSeconds: number, model: string, language?: string): CloneTranscript {
  const chunks = Array.isArray(raw.chunks) ? raw.chunks as RawChunk[] : [];
  const words = normalizeWords(chunks, Math.max(0, durationSeconds));
  const segments = groupTranscriptWords(words);
  const text = cleanText(raw.text || segments.map((segment) => segment.text).join(' '));
  return {
    text,
    segments,
    words,
    model,
    ...(language ? { language } : {}),
  };
}

async function getLocalTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const model = String(process.env.SANMAO_CLONE_ASR_MODEL || DEFAULT_CLONE_ASR_MODEL).trim() || DEFAULT_CLONE_ASR_MODEL;
      const modelCache = path.join(resolveLocalDataDir(), 'models', 'transformers');
      const { env, pipeline } = await import('@huggingface/transformers');
      env.cacheDir = modelCache;
      env.allowLocalModels = true;
      env.allowRemoteModels = process.env.SANMAO_CLONE_ASR_LOCAL_ONLY !== '1';
      const loaded = await pipeline('automatic-speech-recognition', model, {
        cache_dir: modelCache,
        local_files_only: process.env.SANMAO_CLONE_ASR_LOCAL_ONLY === '1',
        device: 'cpu',
        dtype: 'q8',
      });
      return loaded as unknown as LocalTranscriber;
    })().catch((error) => {
      transcriberPromise = null;
      throw error;
    });
  }
  return transcriberPromise;
}

export async function transcribeLocalAudio(file: string, durationSeconds: number): Promise<CloneTranscript> {
  const audio = readPcm16Wav(await readFile(file));
  const model = String(process.env.SANMAO_CLONE_ASR_MODEL || DEFAULT_CLONE_ASR_MODEL).trim() || DEFAULT_CLONE_ASR_MODEL;
  const language = String(process.env.SANMAO_CLONE_ASR_LANGUAGE || '').trim() || undefined;
  const transcriber = await getLocalTranscriber();
  const result = await transcriber(audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(language ? { language, task: 'transcribe' } : {}),
  });
  return normalizeLocalAsrResult(result, durationSeconds, model, language);
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

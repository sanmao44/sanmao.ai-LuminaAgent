import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AutomaticSpeechRecognitionOutput, ProgressInfo } from '@huggingface/transformers';
import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { decodeAudioToPcmWav } from './ffmpeg-decoder';

export const DEFAULT_LOCAL_ASR_MODEL = 'Xenova/whisper-small';
const MAX_TRANSCRIPT_WORDS = 4_000;
const MAX_TRANSCRIPT_SEGMENTS = 1_000;
const ASR_SAMPLE_RATE = 16_000;

type RawChunk = { text?: unknown; timestamp?: unknown };
type LocalTranscriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<AutomaticSpeechRecognitionOutput>;

export type LocalTranscriptionProgress = {
  stage: 'decoding-audio' | 'loading-model' | 'transcribing';
  progress?: number;
  file?: string;
};

export type LocalTranscriptionOptions = {
  model?: string;
  language?: string;
  localOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranscriptionProgress) => void;
};

const transcriberPromises = new Map<string, Promise<LocalTranscriber>>();

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
    throw new Error('Local ASR expected a WAV file');
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
      if (format !== 1) throw new Error('Local ASR expected PCM WAV');
    }
    if (id === 'data') {
      dataStart = body;
      dataLength = Math.min(size, buffer.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (channels !== 1 || sampleRate !== ASR_SAMPLE_RATE || bitsPerSample !== 16 || dataStart < 0 || dataLength < 2) {
    throw new Error('Local ASR expected mono 16 kHz PCM WAV');
  }
  const samples = new Float32Array(Math.floor(dataLength / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(dataStart + index * 2) / 32_768;
  return samples;
}

function normalizeWords(chunks: readonly RawChunk[], durationSeconds: number): TimestampedTranscriptWord[] {
  const words: TimestampedTranscriptWord[] = [];
  for (const chunk of chunks.slice(0, MAX_TRANSCRIPT_WORDS)) {
    const text = cleanText(chunk.text);
    const pair = timestampPair(chunk.timestamp);
    if (!text || !pair) continue;
    const start = round3(Math.min(Math.max(0, pair[0]), durationSeconds));
    const end = round3(Math.min(Math.max(start, pair[1]), durationSeconds));
    if (end <= start) continue;
    words.push({ start, end, text });
  }
  return words;
}

function endsSentence(text: string) {
  return /[。！？.!?;；]$/u.test(text);
}

function needsWordSpace(previous: string, next: string) {
  if (/^[，。！？；：,.!?;:、）】》」』]/u.test(next)) return false;
  if (/[（【《「『]$/u.test(previous)) return false;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  return !cjk.test(previous.slice(-1)) && !cjk.test(next.slice(0, 1));
}

/** Group timestamped ASR words into stable subtitle-sized segments. */
export function groupTranscriptWords(words: readonly TimestampedTranscriptWord[], maxSegmentSeconds = 5): TimestampedTranscriptSegment[] {
  const segments: TimestampedTranscriptSegment[] = [];
  let current: TimestampedTranscriptSegment | null = null;
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
    current.text = `${current.text}${needsWordSpace(current.text, word.text) ? ' ' : ''}${word.text}`.trim();
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

export function normalizeLocalAsrResult(raw: AutomaticSpeechRecognitionOutput, durationSeconds: number, model: string, language?: string): LocalTranscriptionResult {
  const chunks = Array.isArray(raw.chunks) ? raw.chunks as RawChunk[] : [];
  const words = normalizeWords(chunks, Math.max(0, durationSeconds));
  const segments = groupTranscriptWords(words);
  const text = cleanText(raw.text || segments.map((segment) => segment.text).join(' '));
  return { text, segments, words, model, ...(language ? { language } : {}) };
}

function progressFromTransformers(onProgress?: LocalTranscriptionOptions['onProgress']) {
  return (info: ProgressInfo) => {
    const record = info as ProgressInfo & { progress?: number; file?: string };
    onProgress?.({
      stage: 'loading-model',
      ...(Number.isFinite(record.progress) ? { progress: Math.max(0, Math.min(100, Number(record.progress))) } : {}),
      ...(typeof record.file === 'string' ? { file: record.file.slice(0, 160) } : {}),
    });
  };
}

async function getLocalTranscriber(model: string, localOnly: boolean, onProgress?: LocalTranscriptionOptions['onProgress']) {
  const cacheKey = `${model}:${localOnly ? 'local' : 'remote'}`;
  let pending = transcriberPromises.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const modelCache = path.join(resolveLocalDataDir(), 'models', 'transformers');
      const { env, pipeline } = await import('@huggingface/transformers');
      env.cacheDir = modelCache;
      env.allowLocalModels = true;
      env.allowRemoteModels = !localOnly;
      const loaded = await pipeline('automatic-speech-recognition', model, {
        cache_dir: modelCache,
        local_files_only: localOnly,
        device: 'cpu',
        dtype: 'q8',
        progress_callback: progressFromTransformers(onProgress),
      });
      return loaded as unknown as LocalTranscriber;
    })().catch((error) => {
      transcriberPromises.delete(cacheKey);
      throw error;
    });
    transcriberPromises.set(cacheKey, pending);
  }
  return pending;
}

function resolvedOptions(options: LocalTranscriptionOptions = {}) {
  return {
    model: String(options.model || process.env.SANMAO_ASR_MODEL || DEFAULT_LOCAL_ASR_MODEL).trim() || DEFAULT_LOCAL_ASR_MODEL,
    language: String(options.language || process.env.SANMAO_ASR_LANGUAGE || '').trim() || undefined,
    localOnly: options.localOnly ?? process.env.SANMAO_ASR_LOCAL_ONLY === '1',
  };
}

export async function transcribeLocalPcmWav(filePath: string, durationSeconds: number, options: LocalTranscriptionOptions = {}): Promise<LocalTranscriptionResult> {
  if (options.signal?.aborted) throw options.signal.reason || new Error('Transcription cancelled');
  const audio = readPcm16Wav(await readFile(filePath));
  const resolved = resolvedOptions(options);
  const duration = durationSeconds > 0 ? durationSeconds : audio.length / ASR_SAMPLE_RATE;
  const transcriber = await getLocalTranscriber(resolved.model, resolved.localOnly, options.onProgress);
  if (options.signal?.aborted) throw options.signal.reason || new Error('Transcription cancelled');
  options.onProgress?.({ stage: 'transcribing' });
  const result = await transcriber(audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(resolved.language ? { language: resolved.language, task: 'transcribe' } : {}),
  });
  return normalizeLocalAsrResult(result, duration, resolved.model, resolved.language);
}

/** Decode MP3, M4A, WAV and other FFmpeg-supported audio before local transcription. */
export async function transcribeLocalAudioFile(filePath: string, durationSeconds: number, options: LocalTranscriptionOptions = {}): Promise<LocalTranscriptionResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-asr-'));
  const pcmWavPath = path.join(directory, 'audio.wav');
  try {
    options.onProgress?.({ stage: 'decoding-audio' });
    const timeoutMs = Math.max(120_000, Math.ceil(Math.max(1, durationSeconds) * 2_000));
    await decodeAudioToPcmWav(filePath, pcmWavPath, { timeoutMs, signal: options.signal });
    return await transcribeLocalPcmWav(pcmWavPath, durationSeconds, options);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function toSrtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1_000);
  const fraction = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(fraction).padStart(3, '0')}`;
}

/** Serialize timestamped segments without asking a language model to rewrite their timings. */
export function formatSrt(segments: readonly TimestampedTranscriptSegment[]) {
  const cues = segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && cleanText(segment.text))
    .map((segment, index) => `${index + 1}\r\n${toSrtTime(segment.start)} --> ${toSrtTime(segment.end)}\r\n${cleanText(segment.text)}`);
  return cues.length ? `${cues.join('\r\n\r\n')}\r\n` : '';
}

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AutomaticSpeechRecognitionOutput, ProgressInfo } from '@huggingface/transformers';
import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { decodeAudioToPcmWav } from './ffmpeg-decoder';

export const DEFAULT_LOCAL_ASR_MODEL = 'Xenova/whisper-small';
const ASR_SAMPLE_RATE = 16_000;

type RawChunk = { text?: unknown; timestamp?: unknown };
type WhisperTokenizer = {
  encode?: (text: string, options?: { add_special_tokens?: boolean }) => number[];
  convert_tokens_to_ids?: (tokens: string | string[]) => number | number[];
};
type WhisperGenerationConfig = {
  decoder_start_token_id?: unknown;
  is_multilingual?: unknown;
  lang_to_id?: Record<string, unknown>;
  task_to_id?: Record<string, unknown>;
};
export type LocalTranscriber = ((audio: Float32Array, options: Record<string, unknown>) => Promise<AutomaticSpeechRecognitionOutput>) & {
  tokenizer?: WhisperTokenizer;
  model?: { generation_config?: WhisperGenerationConfig | null; config?: WhisperGenerationConfig };
};

export type LocalTranscriptionProgress = {
  stage: 'decoding-audio' | 'loading-model' | 'transcribing';
  progress?: number;
  file?: string;
};

export type LocalTranscriptionOptions = {
  model?: string;
  language?: string;
  /** Optional glossary text used as a bounded Whisper decoder prompt when supported. */
  referenceText?: string;
  localOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranscriptionProgress) => void;
};

const transcriberPromises = new Map<string, Promise<LocalTranscriber>>();
const promptedTranscriberQueues = new WeakMap<LocalTranscriber, Promise<void>>();
const MAX_PROMPT_TOKENS = 224;
const MODEL_TEMP_FILE_PATTERN = /\.tmp\.[^/\\]+$/u;
const MODEL_TEMP_MAX_AGE_MS = 60 * 60 * 1_000;
const LOCAL_MODEL_LOAD_ERROR = '本地语音识别模型下载或加载失败，请检查网络连接后重试。首次使用会自动下载并缓存模型。';
const DEFAULT_LOCAL_MODEL_MIRROR = 'https://hf-mirror.com/';
let modelLoadQueue = Promise.resolve();

function isLocalModelNetworkFailure(error: unknown) {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
  return /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|certificate/i.test(messages.join(' '));
}

async function withExclusiveModelLoad<T>(work: () => Promise<T>) {
  const previous = modelLoadQueue;
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  modelLoadQueue = current;
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (modelLoadQueue === current) modelLoadQueue = Promise.resolve();
  }
}

async function removeInterruptedModelDownloads(modelDirectory: string, now = Date.now()): Promise<number> {
  let removed = 0;
  let entries;
  try {
    entries = await readdir(modelDirectory, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const entryPath = path.join(modelDirectory, entry.name);
    if (entry.isDirectory()) {
      removed += await removeInterruptedModelDownloads(entryPath, now);
      continue;
    }
    if (!entry.isFile() || !MODEL_TEMP_FILE_PATTERN.test(entry.name)) continue;
    try {
      const details = await stat(entryPath);
      if (now - details.mtimeMs < MODEL_TEMP_MAX_AGE_MS) continue;
      const processId = Number(entry.name.match(/\.tmp\.(\d+)\./u)?.[1]);
      if (Number.isInteger(processId) && processId > 0 && processId <= 2_147_483_647) {
        try {
          process.kill(processId, 0);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') continue;
        }
      }
      await rm(entryPath, { force: true });
      removed += 1;
    } catch {
      // A concurrent process may finish or remove the temporary file first.
    }
  }
  return removed;
}

/** Load a local model and recover once from an interrupted or corrupt cache. */
export async function loadWithLocalModelCacheRecovery<T>(
  modelDirectory: string,
  localOnly: boolean,
  load: () => Promise<T>,
  onRetry?: (error: unknown) => void | Promise<void>,
) {
  await removeInterruptedModelDownloads(modelDirectory);
  try {
    return await load();
  } catch (firstError) {
    if (localOnly) {
      const error = new Error('本地语音识别模型缓存不可用，请允许首次联网下载模型后重试。', { cause: firstError });
      error.name = 'LocalTranscriptionModelError';
      throw error;
    }
    if (!isLocalModelNetworkFailure(firstError)) {
      const onnxDirectory = path.join(modelDirectory, 'onnx');
      try {
        const entries = await readdir(onnxDirectory, { withFileTypes: true });
        await Promise.all(entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.onnx'))
          .map((entry) => rm(path.join(onnxDirectory, entry.name), { force: true })));
      } catch {
        // The model may have failed before creating its ONNX cache directory.
      }
    }
    await onRetry?.(firstError);
    try {
      return await load();
    } catch (secondError) {
      const error = new Error(LOCAL_MODEL_LOAD_ERROR, { cause: secondError });
      error.name = 'LocalTranscriptionModelError';
      throw error;
    }
  }
}

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

function finiteTokenId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

function specialTokenId(tokenizer: WhisperTokenizer, token: string) {
  if (typeof tokenizer.convert_tokens_to_ids !== 'function') return undefined;
  try {
    return finiteTokenId(tokenizer.convert_tokens_to_ids(token));
  } catch {
    return undefined;
  }
}

/**
 * Transformers.js 4.2.0 documents `prompt_ids` but does not consume it in
 * Whisper's generation path. Build the equivalent decoder prefix explicitly.
 */
export function buildWhisperDecoderInputIds(transcriber: LocalTranscriber, referenceText?: string, language?: string) {
  const text = cleanText(referenceText).slice(0, 2_000);
  const tokenizer = transcriber.tokenizer;
  const encode = tokenizer?.encode;
  if (!text || !tokenizer || typeof encode !== 'function') return undefined;
  try {
    const promptIds = encode.call(tokenizer, `<|startofprev|> ${text}`, { add_special_tokens: false })
      .filter((id) => Number.isInteger(id) && id >= 0)
      .slice(0, MAX_PROMPT_TOKENS);
    if (!promptIds.length) return undefined;

    const generation = transcriber.model?.generation_config || transcriber.model?.config;
    const prefix: number[] = [];
    const decoderStart = finiteTokenId(generation?.decoder_start_token_id) ?? specialTokenId(tokenizer, '<|startoftranscript|>');
    if (decoderStart !== undefined) prefix.push(decoderStart);

    const requestedLanguage = String(language || '').trim().toLowerCase();
    const languageToken = requestedLanguage ? `<|${requestedLanguage}|>` : '<|en|>';
    const languageId = finiteTokenId(generation?.lang_to_id?.[languageToken]) ?? specialTokenId(tokenizer, languageToken);
    const multilingual = generation?.is_multilingual !== false;
    if (multilingual && languageId !== undefined) prefix.push(languageId);

    const taskId = finiteTokenId(generation?.task_to_id?.['transcribe']) ?? specialTokenId(tokenizer, '<|transcribe|>');
    if (multilingual && taskId !== undefined) prefix.push(taskId);

    // Hugging Face prepends prompt_ids before the normal Whisper language/task prefix.
    return [...promptIds, ...prefix];
  } catch {
    // Tokenizer prompt support is optional across Transformers.js model versions.
    return undefined;
  }
}

/** Serialize prompted calls per pipeline instance so mutable model state cannot mix prompts. */
export async function runPromptedLocalTranscriber(
  transcriber: LocalTranscriber,
  audio: Float32Array,
  options: Record<string, unknown>,
) {
  const previous = promptedTranscriberQueues.get(transcriber) || Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  promptedTranscriberQueues.set(transcriber, current);
  await previous.catch(() => undefined);
  try {
    return await transcriber(audio, options);
  } finally {
    release();
    if (promptedTranscriberQueues.get(transcriber) === current) promptedTranscriberQueues.delete(transcriber);
  }
}

function timestampPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const numeric = (item: unknown) => item === null || item === undefined || item === '' ? NaN : finite(item, NaN);
  const start = Math.max(0, numeric(value[0]));
  const end = numeric(value[1]);
  if (!Number.isFinite(start)) return null;
  return [round3(start), Number.isFinite(end) ? round3(Math.max(start, end)) : NaN];
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
  let lastTextIndex = -1;
  for (let index = 0; index < chunks.length; index += 1) {
    if (cleanText(chunks[index].text)) lastTextIndex = index;
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const text = cleanText(chunk.text);
    const pair = timestampPair(chunk.timestamp);
    if (!text || !pair) continue;
    const start = round3(Math.min(Math.max(0, pair[0]), durationSeconds));
    const rawEnd = Number.isFinite(pair[1]) ? pair[1] : index === lastTextIndex ? durationSeconds : NaN;
    if (!Number.isFinite(rawEnd)) continue;
    const end = round3(Math.min(Math.max(start, rawEnd), durationSeconds));
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
  return segments.map((segment) => ({
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
      const modelDirectory = path.resolve(modelCache, ...model.split(/[\\/]+/u).filter(Boolean));
      const { env, pipeline } = await import('@huggingface/transformers');
      env.cacheDir = modelCache;
      env.allowLocalModels = true;
      env.allowRemoteModels = !localOnly;
      const defaultRemoteHost = String(env.remoteHost || '').trim();
      const configuredMirror = String(process.env.SANMAO_ASR_MODEL_MIRROR || DEFAULT_LOCAL_MODEL_MIRROR).trim();
      const mirrorRemoteHost = configuredMirror && configuredMirror.toLowerCase() !== 'off'
        ? `${configuredMirror.replace(/\/+$/u, '')}/`
        : '';
      const load = () => pipeline('automatic-speech-recognition', model, {
        cache_dir: modelCache,
        local_files_only: localOnly,
        device: 'cpu',
        dtype: 'q8',
        progress_callback: progressFromTransformers(onProgress),
      });
      // Serialize every remote load, including a first download. Transformers.js
      // stores the remote host on a shared env object, so a concurrent request
      // could otherwise restore it while another request is retrying through
      // the mirror. The recovery helper is safe when the cache directory does
      // not exist yet and gives first-time users the same fallback path.
      const loaded = await withExclusiveModelLoad(async () => {
        try {
          return await loadWithLocalModelCacheRecovery(modelDirectory, localOnly, load, (error) => {
            if (isLocalModelNetworkFailure(error) && mirrorRemoteHost && mirrorRemoteHost !== defaultRemoteHost) env.remoteHost = mirrorRemoteHost;
          });
        } finally {
          env.remoteHost = defaultRemoteHost;
        }
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
  const decoderInputIds = buildWhisperDecoderInputIds(transcriber, options.referenceText, resolved.language);
  const transcribeOptions = {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(decoderInputIds ? { decoder_input_ids: decoderInputIds } : {}),
    ...(resolved.language ? { language: resolved.language, task: 'transcribe' } : {}),
  };
  const result = decoderInputIds
    ? await runPromptedLocalTranscriber(transcriber, audio, transcribeOptions)
    : await transcriber(audio, transcribeOptions);
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

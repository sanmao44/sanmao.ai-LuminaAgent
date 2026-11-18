import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AutomaticSpeechRecognitionOutput, ProgressInfo } from '@huggingface/transformers';
import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { correctTranscriptWithReference, projectReferencePunctuation } from './reference-script-correction';
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
const MAX_PROMPT_TOKENS = 64;
const MAX_REFERENCE_PROMPT_CHARS = 160;
const MAX_UNSPACED_CUE_CHARS = 20;
const SOFT_UNSPACED_CUE_CHARS = 24;
const MAX_REPAIRED_CUE_CHARS = MAX_UNSPACED_CUE_CHARS;
// Covers known high-risk subtitle seams; word segmentation is only a fallback.
const PROTECTED_CJK_BOUNDARY_TERMS = new Set([
  '持续', '深化', '协作', '时长', '小于', '大于', '识别', '分析', '应急', '事件', '处理', '小时', '分钟',
  '以内', '以上', '降低', '提升', '优化', '改善', '业务', '体验', '应用', '场景', '工作', '效率', '数据',
  '网络', '设备', '自动', '调度', '保障', '服务', '系统', '能力', '字幕', '语音', '模型', '文档', '参考',
  '结果', '时间', '平均', '方案', '项目', '支持', '实际', '内容', '专业', '功能', '问题', '范围', '覆盖',
]);
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

function buildReferencePrompt(referenceText?: string) {
  const text = cleanText(referenceText);
  if (!text) return '';
  if (Array.from(text).length <= MAX_REFERENCE_PROMPT_CHARS && !/[。！？!?；;，,]/u.test(text)) return text;

  const terms = new Set<string>();
  for (const match of text.matchAll(/[《「『“【]([^》」』”】\r\n]{2,20})[》」』”】]/gu)) {
    const term = cleanText(match[1]);
    if (term && !/[。！？!?；;，,]/u.test(term)) terms.add(term);
  }
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[._+-][A-Za-z0-9]+)*/gu)) {
    const term = match[0];
    const uppercaseCount = Array.from(term).filter((character) => /[A-Z]/u.test(character)).length;
    if (/[0-9._+-]/u.test(term) || uppercaseCount >= 2) terms.add(term);
  }
  return Array.from(terms).join(' ').slice(0, MAX_REFERENCE_PROMPT_CHARS);
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
  const text = buildReferencePrompt(referenceText);
  if (!text || Array.from(text).length > MAX_REFERENCE_PROMPT_CHARS || /[。！？!?；;，,]/u.test(text)) return undefined;
  const tokenizer = transcriber.tokenizer;
  const encode = tokenizer?.encode;
  if (!tokenizer || typeof encode !== 'function') return undefined;
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

function isUnspacedScript(text: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}

function startsChineseClause(value: string) {
  return /^(?:依托|针对|构建|实现|在(?!上)|并|同时|进一步|强化|推动|提升|释放|让|灾害|事件|全链路|中国移动|随后|然后)/u.test(value);
}

function endsChinesePhrase(value: string) {
  return /(?:协作|保障|处置|闭环|能力|目标|体系|经营|体验|方向|步伐|未来|以上|以内|三省)$/u.test(value);
}

function softBoundaryScore(characters: readonly string[], cut: number, targetSize: number) {
  if (cut <= 0 || cut >= characters.length) return Number.NEGATIVE_INFINITY;
  const left = characters.slice(0, cut).join('');
  const right = characters.slice(cut).join('');
  if ((/\d$/u.test(left) && /^[.,]\d/u.test(right)) || (/\d[.,]$/u.test(left) && /^\d/u.test(right))) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = -Math.abs(cut - targetSize) * 2;
  if (/[，。！？；：,.!?;:]$/u.test(left)) score += 100;
  if (startsChineseClause(right)) score += 42;
  if (endsChinesePhrase(left)) score += 18;
  if (/^[，。！？；：,.!?;:、）】》」』]/u.test(right)) score -= 100;
  if (/(?:的|和|与|及|等|了|着|地|得|在|于|向|为)$/u.test(left)) score -= 18;
  if (/^(?:的|和|与|及|等|了|着|地|得|于|向|为)/u.test(right)) score -= 18;
  return score;
}

function isNumericContinuation(leftText: string, rightText: string) {
  return (
    /\p{N}$/u.test(leftText)
    && /^(?:\p{N}|[.,]\p{N})/u.test(rightText)
  ) || (
    /\p{N}[.,]$/u.test(leftText)
    && /^\p{N}/u.test(rightText)
  );
}

function hasPunctuationAtBoundary(leftText: string, rightText: string) {
  return /[，。？！；：,!?;:、”’"']$/u.test(leftText) || /^[，。？！；：,!?;:、“‘"']/u.test(rightText);
}

function mappedTranscriptionCharacters(text: string) {
  return Array.from(text).flatMap((character, charIndex) => (
    Array.from(character.normalize('NFKC').toLowerCase())
      .filter((normalized) => /[\p{L}\p{N}\p{S}]/u.test(normalized))
      .map((value) => ({ value, charIndex }))
  ));
}

function uniqueReferenceBoundary(leftText: string, rightText: string, referenceText?: string) {
  if (!referenceText?.trim()) return null;
  const leftPoints = mappedTranscriptionCharacters(leftText).slice(-5);
  const rightPoints = mappedTranscriptionCharacters(rightText).slice(0, 5);
  if (leftPoints.length < 2 || rightPoints.length < 2 || leftPoints.length + rightPoints.length < 5) return null;

  const documentText = referenceText.replace(/^\s*\[[^\]\r\n]{1,160}\]\s*/u, '');
  const referencePoints = mappedTranscriptionCharacters(documentText);
  const context = [...leftPoints, ...rightPoints].map((point) => point.value);
  let matchStart = -1;
  for (let start = 0; start + context.length <= referencePoints.length; start += 1) {
    if (!context.every((value, offset) => referencePoints[start + offset].value === value)) continue;
    if (matchStart >= 0) return null;
    matchStart = start;
  }
  if (matchStart < 0) return null;

  const previous = referencePoints[matchStart + leftPoints.length - 1];
  const following = referencePoints[matchStart + leftPoints.length];
  const separator = Array.from(documentText).slice(previous.charIndex + 1, following.charIndex).join('');
  return { leftPoints, rightPoints, context: context.join(''), boundary: leftPoints.length, separator };
}

function referenceMatchedUnsafeTextMove(leftText: string, rightText: string, referenceText?: string) {
  const numericContinuation = isNumericContinuation(leftText, rightText);
  const match = uniqueReferenceBoundary(leftText, rightText, referenceText);
  if (!match) return null;

  if (numericContinuation) {
    const sourceHasDecimal = /\p{N}\.$/u.test(leftText) || /^\.\p{N}/u.test(rightText);
    if (hasPunctuationAtBoundary(leftText, rightText) && !(match.separator === '.' && sourceHasDecimal)) return null;
    if (match.separator && match.separator !== '.') return null;
    const number = rightText.match(/^(?:\.\p{N}+|\p{N}+)/u)?.[0];
    if (!number) return null;
    const restoreDecimal = /\p{N}$/u.test(leftText)
      && /^\p{N}/u.test(rightText)
      && match.separator === '.'
      ? '.'
      : '';
    return { direction: 'right' as const, moveLength: number.length, separator: restoreDecimal };
  }

  if (hasPunctuationAtBoundary(leftText, rightText)) return null;
  if (match.separator && /[\p{P}\p{S}]/u.test(match.separator)) return null;
  for (const term of PROTECTED_CJK_BOUNDARY_TERMS) {
    let start = match.context.indexOf(term);
    while (start >= 0) {
      if (start < match.boundary && start + term.length > match.boundary) {
        const leftContextStart = match.leftPoints[0].charIndex;
        const pointOffset = start;
        const moveStart = match.leftPoints[pointOffset].charIndex;
        if (moveStart >= leftContextStart && moveStart < leftText.length) return { direction: 'left' as const, moveStart, separator: '' };
      }
      start = match.context.indexOf(term, start + 1);
    }
  }

  if (typeof Intl.Segmenter !== 'function') return null;
  const points = [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(match.context)];
  for (const part of points) {
    if (!part.isWordLike) continue;
    const start = Array.from(match.context.slice(0, part.index)).length;
    const end = start + Array.from(part.segment).length;
    if (start >= match.boundary || end <= match.boundary) continue;
    const moveStart = match.leftPoints[start]?.charIndex;
    if (moveStart !== undefined && moveStart < leftText.length) return { direction: 'left' as const, moveStart, separator: '' };
  }
  return null;
}

function referenceMatchedUnsafeTextBoundary(leftText: string, rightText: string, referenceText?: string) {
  return referenceMatchedUnsafeTextMove(leftText, rightText, referenceText) !== null;
}

export function restoreReferenceDecimalSeparators(text: string, referenceText?: string) {
  if (!referenceText?.trim()) return text;
  const characters = Array.from(text);
  for (let index = 1; index < characters.length; index += 1) {
    if (!/\p{N}/u.test(characters[index - 1]) || !/\p{N}/u.test(characters[index])) continue;
    const match = referenceMatchedUnsafeTextMove(characters.slice(0, index).join(''), characters.slice(index).join(''), referenceText);
    if (match?.direction !== 'right' || match.separator !== '.') continue;
    characters.splice(index, 0, '.');
    index += 1;
  }
  return characters.join('');
}

function chooseUnspacedCut(characters: readonly string[], targetSize: number, allowSoftExpansion: boolean, referenceText?: string) {
  const lowerBound = Math.max(1, Math.floor(targetSize * 0.65));
  const upperBound = Math.min(characters.length - 1, targetSize + (allowSoftExpansion ? 4 : 0));
  let bestCut = Math.min(targetSize, characters.length - 1);
  let bestScore = softBoundaryScore(characters, bestCut, targetSize);
  let bestSafeCut = -1;
  let bestSafeScore = Number.NEGATIVE_INFINITY;
  for (let cut = lowerBound; cut <= upperBound; cut += 1) {
    const score = softBoundaryScore(characters, cut, targetSize);
    if (score > bestScore) {
      bestScore = score;
      bestCut = cut;
    }
    const left = characters.slice(0, cut).join('');
    const right = characters.slice(cut).join('');
    if (!referenceMatchedUnsafeTextBoundary(left, right, referenceText) && score > bestSafeScore) {
      bestSafeScore = score;
      bestSafeCut = cut;
    }
  }
  return bestSafeCut >= 0 ? bestSafeCut : bestCut;
}

function splitUnspacedChunk(text: string, start: number, end: number, referenceText?: string): TimestampedTranscriptWord[] {
  const characters = Array.from(text);
  const duration = Math.max(0, end - start);
  const pieceCount = Math.min(characters.length, Math.max(
    Math.ceil(characters.length / MAX_UNSPACED_CUE_CHARS),
    Math.ceil(duration / 5),
  ));
  const targetSize = Math.max(1, Math.ceil(characters.length / pieceCount));
  const pieces: string[] = [];
  let remaining = characters;
  const allowSoftExpansion = duration <= 6;
  while (remaining.length > targetSize) {
    const cut = chooseUnspacedCut(remaining, targetSize, allowSoftExpansion, referenceText);
    pieces.push(remaining.slice(0, cut).join(''));
    remaining = remaining.slice(cut);
  }
  if (remaining.length) pieces.push(remaining.join(''));

  const totalWeight = pieces.reduce((sum, piece) => sum + Array.from(piece).length, 0);
  let elapsedWeight = 0;
  return pieces.map((piece, index) => {
    const pieceStart = start + duration * elapsedWeight / totalWeight;
    elapsedWeight += Array.from(piece).length;
    const pieceEnd = index === pieces.length - 1
      ? end
      : start + duration * elapsedWeight / totalWeight;
    return { start: round3(pieceStart), end: round3(pieceEnd), text: piece };
  });
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

function normalizeWords(chunks: readonly RawChunk[], durationSeconds: number, referenceText?: string): TimestampedTranscriptWord[] {
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
    if (isUnspacedScript(text) && (Array.from(text).length > MAX_UNSPACED_CUE_CHARS || end - start > 5)) {
      words.push(...splitUnspacedChunk(text, start, end, referenceText));
    } else {
      words.push({ start, end, text });
    }
  }
  return stitchDecimalContinuations(words);
}

function stitchDecimalContinuations(words: readonly TimestampedTranscriptWord[]) {
  const stitched: TimestampedTranscriptWord[] = [];
  for (const word of words) {
    const previous = stitched.at(-1);
    const gap = previous ? word.start - previous.end : Infinity;
    const decimalContinuation = previous && (
      (/\d$/u.test(previous.text) && /^[.,]\d/u.test(word.text))
      || (/\d[.,]$/u.test(previous.text) && /^\d/u.test(word.text))
    );
    if (!previous || !decimalContinuation || gap > 0.35) {
      stitched.push(word);
      continue;
    }

    stitched.pop();
    const text = `${previous.text}${word.text}`;
    const start = previous.start;
    const end = Math.max(previous.end, word.end);
    if (isUnspacedScript(text) && (Array.from(text).length > MAX_UNSPACED_CUE_CHARS || end - start > 5)) {
      stitched.push(...splitUnspacedChunk(text, start, end));
    } else {
      stitched.push({ start, end, text });
    }
  }
  return stitched;
}

function endsSentence(text: string) {
  return /[。！？.!?;；]$/u.test(text);
}

function endsSubtitleClause(text: string) {
  return /[，、：,]$/u.test(text) && Array.from(text).length >= 8;
}

function needsWordSpace(previous: string, next: string) {
  if (/^[，。！？；：,.!?;:、）】》」』]/u.test(next)) return false;
  if (/[，。！？；：,.!?;:、]$/u.test(previous)) return false;
  if (/[（【《「『]$/u.test(previous)) return false;
  return !isUnspacedScript(previous.slice(-1)) && !isUnspacedScript(next.slice(0, 1));
}

/** Group timestamped ASR words into stable subtitle-sized segments. */
export function groupTranscriptWords(words: readonly TimestampedTranscriptWord[], maxSegmentSeconds = 5, referenceText?: string): TimestampedTranscriptSegment[] {
  const segments: TimestampedTranscriptSegment[] = [];
  let current: TimestampedTranscriptSegment | null = null;
  for (const word of words) {
    if (!current) {
      current = { start: word.start, end: word.end, text: word.text, words: [word] };
      continue;
    }
    const gap = Math.max(0, word.start - current.end);
    const longEnough = word.end - current.start >= maxSegmentSeconds;
    const unspacedTextTooLong = isUnspacedScript(current.text) &&
      isUnspacedScript(word.text) &&
      Array.from(`${current.text}${word.text}`).length > MAX_UNSPACED_CUE_CHARS;
    const numericContinuation = isNumericContinuation(current.text, word.text);
    const numericMatch = numericContinuation
      ? referenceMatchedUnsafeTextMove(current.text, word.text, referenceText)
      : null;
    const protectedBoundary = (longEnough || unspacedTextTooLong)
      && gap <= 0.35
      && gap >= -0.15
      && Array.from(`${current.text}${word.text}`).length <= SOFT_UNSPACED_CUE_CHARS
      && word.end - current.start <= maxSegmentSeconds + 4
      && referenceMatchedUnsafeTextBoundary(current.text, word.text, referenceText);
    if ((!numericContinuation && (endsSentence(current.text) || endsSubtitleClause(current.text)))
      || gap > 1.2
      || ((longEnough || unspacedTextTooLong) && !protectedBoundary)) {
      segments.push(current);
      current = { start: word.start, end: word.end, text: word.text, words: [word] };
      continue;
    }
    current.end = word.end;
    if (numericMatch?.separator === '.') {
      current.text += '.';
      const previousWord = current.words?.at(-1);
      if (previousWord && !/[.,]$/u.test(previousWord.text)) previousWord.text += '.';
    }
    current.text = `${current.text}${numericContinuation ? '' : needsWordSpace(current.text, word.text) ? ' ' : ''}${word.text}`.trim();
    current.words?.push(word);
  }
  if (current) segments.push(current);
  const grouped = segments.map((segment) => ({
    ...segment,
    start: round3(segment.start),
    end: round3(segment.end),
    text: cleanText(segment.text),
  }));
  return repairUnsafeTranscriptSegments(grouped, referenceText);
}

function transcriptWordsText(words: readonly TimestampedTranscriptWord[]) {
  return words.reduce((text, word) => {
    const value = cleanText(word.text);
    const separator = isNumericContinuation(text, value) ? '' : needsWordSpace(text, value) ? ' ' : '';
    return `${text}${separator}${value}`;
  }, '').trim();
}

function splitTimestampedWordPrefix(word: TimestampedTranscriptWord, prefixLength: number) {
  const characters = Array.from(word.text);
  const prefix = characters.slice(0, prefixLength).join('');
  const remainder = characters.slice(prefixLength).join('');
  if (!prefix || !remainder) return null;

  const weight = (text: string) => Math.max(1, Array.from(text).filter((character) => /[\p{L}\p{N}\p{S}]/u.test(character)).length);
  const duration = Math.max(0, word.end - word.start);
  const prefixEnd = round3(word.start + duration * weight(prefix) / weight(word.text));
  return {
    prefix: { ...word, end: prefixEnd, text: prefix },
    remainder: { ...word, start: prefixEnd, text: remainder },
  };
}

/** Move only the text needed to keep a reference-confirmed word or number inside one cue. */
export function repairUnsafeTranscriptSegments(
  segments: readonly TimestampedTranscriptSegment[],
  referenceText?: string,
): TimestampedTranscriptSegment[] {
  const repaired = segments.map((segment) => ({ ...segment }));
  for (let index = 0; index + 1 < repaired.length;) {
    const current = repaired[index];
    const next = repaired[index + 1];
    const gap = next.start - current.end;
    const move = referenceMatchedUnsafeTextMove(current.text, next.text, referenceText);
    if (!move) {
      index += 1;
      continue;
    }
    const shouldMove = gap <= 0.35
      && gap >= -0.15
      && Array.from(move.direction === 'left' ? next.text + current.text.slice(move.moveStart) : current.text + next.text.slice(0, move.moveLength) + move.separator).length <= MAX_REPAIRED_CUE_CHARS
      && !endsSentence(current.text)
      && !endsSubtitleClause(current.text);
    if (!shouldMove) {
      index += 1;
      continue;
    }

    if (current.words?.length && next.words?.length) {
      if (move.direction !== 'left') {
        if (!isNumericContinuation(current.text, next.text)) {
          index += 1;
          continue;
        }
        const split = splitTimestampedWordPrefix(next.words[0], move.moveLength);
        if (!split) {
          index += 1;
          continue;
        }
        const movedWord = { ...split.prefix, text: `${move.separator}${split.prefix.text}` };
        const nextWords = [
          ...(split.remainder.text ? [split.remainder] : []),
          ...next.words.slice(1),
        ];
        const currentWords = [...current.words, movedWord];
        const currentText = `${current.text}${movedWord.text}`;
        if (!nextWords.length) {
          repaired[index] = {
            ...current,
            end: movedWord.end,
            text: currentText,
            words: currentWords,
          };
          repaired.splice(index + 1, 1);
          continue;
        }
        repaired[index] = {
          ...current,
          end: movedWord.end,
          text: currentText,
          words: currentWords,
        };
        repaired[index + 1] = {
          ...next,
          start: nextWords[0].start,
          text: transcriptWordsText(nextWords),
          words: nextWords,
        };
        index += 1;
        continue;
      }
      let repairedBoundary = false;
      for (let count = 1; count < current.words.length; count += 1) {
        const retainedWords = current.words.slice(0, -count);
        const movedWords = current.words.slice(-count);
        const nextWords = [...movedWords, ...next.words];
        const retainedLast = retainedWords.at(-1)!;
        const movedFirst = movedWords[0];
        const wordGap = movedFirst.start - retainedLast.end;
        if (wordGap > 0.35 || wordGap < -0.15) break;
        const hasInternalPause = nextWords.some((word, wordIndex) => (
          wordIndex > 0 && word.start - nextWords[wordIndex - 1].end > 0.35
        ));
        if (hasInternalPause) break;

        const retainedText = transcriptWordsText(retainedWords);
        const nextText = transcriptWordsText(nextWords);
        if (!retainedText || Array.from(nextText).length > MAX_REPAIRED_CUE_CHARS) break;
        if (referenceMatchedUnsafeTextMove(retainedText, nextText, referenceText)) continue;

        repaired[index] = {
          ...current,
          end: retainedLast.end,
          text: retainedText,
          words: [...retainedWords],
        };
        repaired[index + 1] = {
          ...next,
          start: movedFirst.start,
          text: nextText,
          words: nextWords,
        };
        repairedBoundary = true;
        break;
      }
      if (repairedBoundary) continue;
      index += 1;
      continue;
    }

    if (current.words?.length || next.words?.length) {
      index += 1;
      continue;
    }

    const textWeight = (value: string) => Math.max(1, Array.from(value).filter((character) => /[\p{L}\p{N}\p{S}]/u.test(character)).length);
    if (move.direction === 'left') {
      const characters = Array.from(current.text);
      const moveText = characters.slice(move.moveStart).join('');
      const remainingText = characters.slice(0, move.moveStart).join('');
      const duration = Math.max(0, current.end - current.start);
      const remainingDuration = duration * textWeight(remainingText) / textWeight(current.text);
      const boundary = Math.max(current.start, Math.min(current.end, current.start + remainingDuration));
      repaired[index] = { ...current, end: boundary, text: remainingText };
      repaired[index + 1] = { ...next, start: boundary, text: `${moveText}${move.separator}${next.text}` };
    } else {
      const characters = Array.from(next.text);
      const moveText = characters.slice(0, move.moveLength).join('');
      const remainingText = characters.slice(move.moveLength).join('');
      const duration = Math.max(0, next.end - next.start);
      const movedDuration = duration * textWeight(moveText) / textWeight(next.text);
      const boundary = Math.max(next.start, Math.min(next.end, next.start + movedDuration));
      repaired[index] = { ...current, end: boundary, text: `${current.text}${move.separator}${moveText}` };
      repaired[index + 1] = { ...next, start: boundary, text: remainingText };
    }
    index += 1;
  }
  return repaired;
}

function transcriptionCharacters(value: string) {
  return Array.from(value.normalize('NFKC').toLowerCase()).filter((character) => /[\p{L}\p{N}\p{S}]/u.test(character));
}

function transcriptionTextSimilarity(left: string, right: string) {
  const source = transcriptionCharacters(left);
  const target = transcriptionCharacters(right);
  const maxLength = Math.max(source.length, target.length);
  if (Math.min(source.length, target.length) < 8 || !maxLength) return 0;

  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let row = 1; row <= source.length; row += 1) {
    const current = new Array<number>(target.length + 1);
    current[0] = row;
    for (let column = 1; column <= target.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (source[row - 1] === target[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[target.length] / maxLength;
}

function areOverlappingDuplicateSegments(left: TimestampedTranscriptSegment, right: TimestampedTranscriptSegment) {
  const shortestDuration = Math.min(left.end - left.start, right.end - right.start);
  if (shortestDuration <= 0) return false;
  if (Math.abs(left.start - right.start) > 0.25) return false;
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  return overlap / shortestDuration >= 0.75 && transcriptionTextSimilarity(left.text, right.text) >= 0.84;
}

function stitchOverlappingDuplicateSegments(segments: readonly TimestampedTranscriptSegment[]) {
  const stitched: TimestampedTranscriptSegment[] = [];
  let removedDuplicate = false;

  for (const segment of segments) {
    let duplicateIndex = -1;
    for (let index = stitched.length - 1; index >= 0; index -= 1) {
      const previous = stitched[index];
      if (segment.start >= previous.end) break;
      if (areOverlappingDuplicateSegments(previous, segment)) {
        duplicateIndex = index;
        break;
      }
    }

    if (duplicateIndex < 0) {
      stitched.push(segment);
      continue;
    }

    const previous = stitched[duplicateIndex];
    const previousLength = transcriptionCharacters(previous.text).length;
    const segmentLength = transcriptionCharacters(segment.text).length;
    const preferred = segmentLength > previousLength ? segment : previous;
    stitched[duplicateIndex] = {
      ...preferred,
      start: Math.min(previous.start, segment.start),
      end: Math.max(previous.end, segment.end),
    };
    removedDuplicate = true;
  }

  return { segments: stitched, removedDuplicate };
}

export function normalizeLocalAsrResult(raw: AutomaticSpeechRecognitionOutput, durationSeconds: number, model: string, language?: string, referenceText?: string): LocalTranscriptionResult {
  const chunks = Array.isArray(raw.chunks) ? raw.chunks as RawChunk[] : [];
  const words = normalizeWords(chunks, Math.max(0, durationSeconds), referenceText);
  const grouped = groupTranscriptWords(words, 5, referenceText);
  const stitched = stitchOverlappingDuplicateSegments(grouped);
  const segments = stitched.segments;
  const normalizedWords = segments.flatMap((segment) => segment.words || []);
  const segmentText = segments.map((segment) => segment.text).join(' ');
  const text = restoreReferenceDecimalSeparators(
    cleanText(stitched.removedDuplicate ? segmentText : raw.text || segmentText),
    referenceText,
  );
  const result = { text, segments, words: normalizedWords, model, ...(language ? { language } : {}) };
  if (!referenceText) return result;

  const corrected = correctTranscriptWithReference(result, referenceText);
  const punctuatedWords = projectReferencePunctuation(corrected.words, referenceText);
  if (punctuatedWords === corrected.words) return corrected;
  const punctuatedSegments = stitchOverlappingDuplicateSegments(groupTranscriptWords(punctuatedWords, 5, referenceText)).segments;
  const punctuatedText = cleanText(punctuatedWords.reduce((value, word) => (
    `${value}${needsWordSpace(value, word.text) ? ' ' : ''}${word.text}`
  ), ''));
  return {
    ...corrected,
    text: punctuatedText,
    segments: punctuatedSegments,
    words: punctuatedSegments.flatMap((segment) => segment.words || []),
  };
}

function hasDominantRepeatedPhrase(text: string) {
  const characters = Array.from(text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''));
  if (characters.length < 48) return false;

  for (let phraseLength = 1; phraseLength <= 12; phraseLength += 1) {
    for (let start = 0; start + phraseLength * 6 <= characters.length; start += 1) {
      let repeats = 1;
      for (let cursor = start + phraseLength; cursor + phraseLength <= characters.length; cursor += phraseLength) {
        let matches = true;
        for (let index = 0; index < phraseLength; index += 1) {
          if (characters[start + index] !== characters[cursor + index]) {
            matches = false;
            break;
          }
        }
        if (!matches) break;
        repeats += 1;
        const repeatedLength = repeats * phraseLength;
        if (repeats >= 6 && repeatedLength >= 48 && repeatedLength / characters.length >= 0.4) return true;
      }
    }
  }
  return false;
}

export function assertLocalTranscriptionQuality(result: LocalTranscriptionResult) {
  const text = result.text || result.segments.map((segment) => segment.text).join(' ');
  const hasLongCue = result.segments.some((segment) => segment.end - segment.start > 15);
  if (!hasLongCue && !hasDominantRepeatedPhrase(text)) return;
  const error = new Error('识别结果出现大段重复文本或异常长字幕时间段，已停止导出字幕。请重试，或缩短参考文档后再生成。');
  error.name = 'LocalTranscriptionQualityError';
  throw error;
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
  const transcript = normalizeLocalAsrResult(result, duration, resolved.model, resolved.language, options.referenceText);
  assertLocalTranscriptionQuality(transcript);
  return transcript;
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

function formatSubtitleText(value: string) {
  const text = cleanText(value)
    .replace(/[，,]/gu, ' ')
    .replace(/、{2,}/gu, '、')
    .replace(/([“”＂"])(?:\s*\1)+/gu, '$1');
  return text
    .replace(/\p{P}/gu, (punctuation, offset: number, source: string) => {
      if (['“', '”', '＂', '"', '%'].includes(punctuation)) return punctuation;
      if (punctuation === '、') {
        const before = source.slice(0, offset).replace(/[\s“＂"]+$/u, '');
        const after = source.slice(offset + punctuation.length).replace(/^[\s”＂"]+/u, '');
        if (!before || !after) return '';
        if (/\p{P}$/u.test(before) || /^\p{P}/u.test(after)) return ' ';
        return punctuation;
      }
      const previous = Array.from(source.slice(0, offset)).at(-1) || '';
      const next = Array.from(source.slice(offset + punctuation.length))[0] || '';
      if ((punctuation === '.' || punctuation === '．') && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)) return punctuation;
      if ((punctuation === ':' || punctuation === '：' || punctuation === '-' || punctuation === '－') && /\p{N}/u.test(previous) && /\p{N}/u.test(next)) return punctuation;
      return /[\p{L}\p{N}”＂"]/u.test(previous) && /[\p{L}\p{N}]/u.test(next) ? ' ' : '';
    })
    .replace(/(?:^|\s)、+|、+(?=\s|$)/gu, ' ')
    .replace(/\s+°/gu, '°')
    .replace(/\s+/gu, ' ')
    .trim();
}

function holdCompressedCueThroughGap(segment: TimestampedTranscriptSegment, next: TimestampedTranscriptSegment | undefined) {
  if (!next || /[。！？.!?]$/u.test(segment.text)) return segment;
  const duration = segment.end - segment.start;
  const gap = next.start - segment.end;
  const cjkCharacters = Array.from(segment.text).filter((character) => /\p{Script=Han}/u.test(character)).length;
  if (cjkCharacters < 6 || duration <= 0 || duration > 0.8 || gap < 0.75 || gap > 6) return segment;
  return { ...segment, end: next.start };
}

/** Serialize timestamped segments without asking a language model to rewrite their timings. */
export function formatSrt(segments: readonly TimestampedTranscriptSegment[]) {
  const captions = segments.flatMap((segment) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start || !cleanText(segment.text)) return [];
    const text = formatSubtitleText(segment.text).replace(/(\d)\s+%/gu, '$1%');
    return text ? [{ ...segment, text }] : [];
  });
  const stabilized = captions.map((segment, index) => holdCompressedCueThroughGap(segment, captions[index + 1]));
  const cues = stabilized.map((segment, index) => (
    `${index + 1}\r\n${toSrtTime(segment.start)} --> ${toSrtTime(segment.end)}\r\n${segment.text}`
  ));
  return cues.length ? `${cues.join('\r\n\r\n')}\r\n` : '';
}

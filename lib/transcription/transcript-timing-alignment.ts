import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';
import { correctTranscriptWithReference, projectReferencePunctuation } from './reference-script-correction';
import { groupTranscriptWords, repairUnsafeTranscriptSegments, restoreReferenceDecimalSeparators } from './local-whisper';

type TimedPoint = { value: string; start: number; end: number };
type TextPoint = { value: string; character: string; offset: number };
type Anchor = { text: number; source: number };

const NGRAM_SIZE = 4;
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MATCHABLE_CHARACTER = /[\p{L}\p{N}\p{S}%]/u;

function comparableCharacter(character: string) {
  const normalized = Array.from(character.normalize('NFKC'));
  return (normalized.length === 1 ? normalized[0] : character).toLowerCase();
}

function transcriptPoints(result: LocalTranscriptionResult): TimedPoint[] {
  const source = result.words.length ? result.words : result.segments;
  return source.flatMap((word) => {
    const characters = Array.from(word.text).filter(MATCHABLE_CHARACTER.test.bind(MATCHABLE_CHARACTER));
    const duration = Math.max(0, word.end - word.start);
    return characters.flatMap((character, index) => {
      if (!character) return [];
      const start = word.start + duration * index / Math.max(1, characters.length);
      const end = word.start + duration * (index + 1) / Math.max(1, characters.length);
      return [{ value: comparableCharacter(character), start, end }];
    });
  });
}

function textPoints(text: string): TextPoint[] {
  return Array.from(text).flatMap((character, offset) => (
    MATCHABLE_CHARACTER.test(character)
      ? [{ value: comparableCharacter(character), character, offset }]
      : []
  ));
}

function uniqueNgrams(points: readonly { value: string }[]) {
  const positions = new Map<string, number>();
  const repeated = new Set<string>();
  for (let offset = 0; offset + NGRAM_SIZE <= points.length; offset += 1) {
    const value = points.slice(offset, offset + NGRAM_SIZE).map((point) => point.value).join('');
    if (positions.has(value)) repeated.add(value);
    else positions.set(value, offset);
  }
  for (const value of repeated) positions.delete(value);
  return positions;
}

function lowerBound(values: readonly number[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function monotonicAnchors(source: readonly TimedPoint[], target: readonly TextPoint[]) {
  const sourcePositions = uniqueNgrams(source);
  const targetPositions = uniqueNgrams(target);
  const candidates = [...targetPositions].flatMap(([value, text]) => {
    const source = sourcePositions.get(value);
    return source === undefined ? [] : [{ text, source }];
  }).sort((left, right) => left.text - right.text);
  if (!candidates.length) return [];

  const tails: number[] = [];
  const tailIndexes: number[] = [];
  const previous = new Int32Array(candidates.length).fill(-1);
  candidates.forEach((candidate, index) => {
    const slot = lowerBound(tails, candidate.source);
    if (slot > 0) previous[index] = tailIndexes[slot - 1];
    tails[slot] = candidate.source;
    tailIndexes[slot] = index;
  });

  const selected: Anchor[] = [];
  let cursor = tailIndexes[tails.length - 1];
  while (cursor !== undefined && cursor >= 0) {
    selected.push(candidates[cursor]);
    cursor = previous[cursor];
  }
  selected.reverse();

  const exact = new Map<number, number>();
  let lastText = -1;
  let lastSource = -1;
  for (const anchor of selected) {
    for (let offset = 0; offset < NGRAM_SIZE; offset += 1) {
      const text = anchor.text + offset;
      const source = anchor.source + offset;
      if (text <= lastText || source <= lastSource) continue;
      exact.set(text, source);
      lastText = text;
      lastSource = source;
    }
  }
  return [...exact].map(([text, source]) => ({ text, source }));
}

function interpolateSourcePosition(index: number, anchors: readonly Anchor[], sourceLength: number, targetLength: number) {
  const exact = anchors.find((anchor) => anchor.text === index);
  if (exact) return exact.source;
  const rightIndex = anchors.findIndex((anchor) => anchor.text > index);
  const left = rightIndex > 0 ? anchors[rightIndex - 1] : { text: -1, source: -1 };
  const right = rightIndex >= 0 ? anchors[rightIndex] : { text: targetLength, source: sourceLength };
  const ratio = (index - left.text) / Math.max(1, right.text - left.text);
  return Math.max(0, Math.min(sourceLength - 1, left.source + ratio * (right.source - left.source)));
}

function mappedInterval(position: number, source: readonly TimedPoint[]) {
  const centerAt = (index: number) => {
    if (index <= 0) return (source[0].start + source[0].end) / 2;
    if (index >= source.length - 1) return (source.at(-1)!.start + source.at(-1)!.end) / 2;
    const lowerIndex = Math.floor(index);
    const fraction = index - lowerIndex;
    const lower = (source[lowerIndex].start + source[lowerIndex].end) / 2;
    const upper = (source[lowerIndex + 1].start + source[lowerIndex + 1].end) / 2;
    return lower + (upper - lower) * fraction;
  };
  const start = Math.max(0, Math.min(centerAt(position - 0.5), centerAt(position + 0.5)));
  const end = Math.max(start + 0.02, Math.max(centerAt(position - 0.5), centerAt(position + 0.5)));
  return { start: Math.round(start * 1_000) / 1_000, end: Math.round(end * 1_000) / 1_000 };
}

function alignedTargetPoints(text: string, source: readonly TimedPoint[]) {
  const target = textPoints(text);
  if (!source.length || !target.length) return [];
  const anchors = monotonicAnchors(source, target);
  const exact = new Map(anchors.map((anchor) => [anchor.text, anchor.source]));
  return target.map((point, index) => {
    const sourcePosition = interpolateSourcePosition(index, anchors, source.length, target.length);
    const timing = exact.has(index)
      ? source[exact.get(index)!]
      : mappedInterval(sourcePosition, source);
    return { ...point, start: timing.start, end: timing.end };
  });
}

function groupTextPoints(text: string, points: readonly (TextPoint & { start: number; end: number })[]): TimestampedTranscriptWord[] {
  const groups: Array<{ points: typeof points[number][]; script: 'cjk' | 'word' }> = [];
  for (const point of points) {
    const script = CJK_CHARACTER.test(point.character) ? 'cjk' : 'word';
    const previous = groups.at(-1);
    const contiguous = previous?.points.at(-1)?.offset === point.offset - 1;
    const maxGroupPoints = script === 'cjk' ? 12 : 40;
    if (!previous || previous.script !== script || !contiguous || previous.points.length >= maxGroupPoints) {
      groups.push({ points: [point], script });
    } else {
      previous.points.push(point);
    }
  }

  return groups.map((group, index) => {
    const first = group.points[0];
    const last = group.points.at(-1)!;
    const next = groups[index + 1]?.points[0];
    const startOffset = index === 0 ? 0 : first.offset;
    const endOffset = next?.offset ?? Array.from(text).length;
    const tokenText = Array.from(text).slice(startOffset, endOffset).join('');
    return {
      start: Math.min(...group.points.map((point) => point.start)),
      end: Math.max(...group.points.map((point) => point.end)),
      text: tokenText,
    };
  });
}

/** Use a text-only cloud transcript while retaining timing from a local timestamped pass. */
export function alignTranscriptTextToLocalTiming(
  cloud: LocalTranscriptionResult,
  local: LocalTranscriptionResult,
  referenceText?: string,
): LocalTranscriptionResult | null {
  const text = String(cloud.text || '').trim();
  if (!text) return null;
  const source = transcriptPoints(local);
  const targetPoints = alignedTargetPoints(text, source);
  if (!targetPoints.length) return null;

  const words = groupTextPoints(text, targetPoints);
  const base: LocalTranscriptionResult = {
    text,
    words,
    segments: groupTranscriptWords(words),
    model: cloud.model,
    ...(cloud.language ? { language: cloud.language } : local.language ? { language: local.language } : {}),
  };
  return applyReferenceTextToTranscript(base, referenceText);
}

export function applyReferenceTextToTranscript(
  transcript: LocalTranscriptionResult,
  referenceText?: string,
): LocalTranscriptionResult {
  const corrected = correctTranscriptWithReference(transcript, referenceText);
  if (!referenceText?.trim()) return corrected;
  const timedWords = corrected.words.length
    ? corrected.words
    : corrected.segments.flatMap((segment) => segment.words || []);
  const punctuatedWords = projectReferencePunctuation(timedWords, referenceText);
  if (punctuatedWords.length) {
    const segments = groupTranscriptWords(punctuatedWords, 5, referenceText);
    return {
      ...corrected,
      words: [...punctuatedWords],
      segments,
    };
  }
  const segments = repairUnsafeTranscriptSegments(corrected.segments, referenceText);
  return {
    ...corrected,
    text: restoreReferenceDecimalSeparators(corrected.text, referenceText),
    segments,
  };
}

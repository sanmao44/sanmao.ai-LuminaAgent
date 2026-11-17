import type { LocalTranscriptionResult, TimestampedTranscriptSegment, TimestampedTranscriptWord } from '@/packages/contracts/transcription';

const MIN_ALIGNMENT_CHARS = 28;
const MAX_ALIGNMENT_CHARS = 48;
const MAX_EDIT_RATIO = 0.16;
const NGRAM_SIZE = 4;
const MAX_NGRAM_POSITIONS = 40;
const MAX_ALIGNMENT_CENTERS = 48;

type MatchPoint = { value: string; original: string };
type SegmentRange = { start: number; end: number };
type TextAlignment = { distance: number; replacements: Map<number, string> };
type TranscriptPoint = { value: string; wordIndex: number; charIndex: number };

const REFERENCE_PUNCTUATION = /^[，,。.!?！？；;：:]$/u;

function roundTimestamp(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function isMatchable(character: string) {
  return /[\p{L}\p{N}\p{S}]/u.test(character);
}

function isLatinCaseMismatch(source: MatchPoint, target: MatchPoint) {
  return source.value === target.value
    && source.original !== target.original
    && /^[A-Za-z]$/u.test(source.original)
    && /^[A-Za-z]$/u.test(target.original);
}

function matchPoints(value: string): MatchPoint[] {
  return Array.from(value).filter(isMatchable).map((original) => {
    const normalized = Array.from(original.normalize('NFKC'));
    const comparable = normalized.length === 1 ? normalized[0] : original;
    const lowercase = comparable.toLowerCase();
    return { original, value: Array.from(lowercase).length === 1 ? lowercase : comparable };
  });
}

function referencePoints(value: string) {
  const documentText = value.replace(/^\s*\[[^\]\r\n]{1,160}\]\s*/gmu, '');
  return matchPoints(documentText);
}

function buildNgramIndex(points: readonly MatchPoint[]) {
  const index = new Map<string, number[]>();
  const uninformative = new Set<string>();
  for (let offset = 0; offset + NGRAM_SIZE <= points.length; offset += 1) {
    const gram = points.slice(offset, offset + NGRAM_SIZE).map((point) => point.value).join('');
    if (uninformative.has(gram)) continue;
    const positions = index.get(gram) || [];
    if (positions.length >= MAX_NGRAM_POSITIONS) {
      index.delete(gram);
      uninformative.add(gram);
      continue;
    }
    positions.push(offset);
    index.set(gram, positions);
  }
  return index;
}

function candidateStarts(source: readonly MatchPoint[], reference: readonly MatchPoint[], index: Map<string, number[]>, maxEdits: number) {
  const votes = new Map<number, number>();
  for (let sourceOffset = 0; sourceOffset + NGRAM_SIZE <= source.length; sourceOffset += 1) {
    const gram = source.slice(sourceOffset, sourceOffset + NGRAM_SIZE).map((point) => point.value).join('');
    for (const referenceOffset of index.get(gram) || []) {
      const start = referenceOffset - sourceOffset;
      if (start < 0 || start + source.length - maxEdits > reference.length) continue;
      votes.set(start, (votes.get(start) || 0) + 1);
    }
  }

  const ranked = [...votes]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .map(([start]) => start);
  const centers: number[] = [];
  for (const start of ranked) {
    if (centers.some((center) => Math.abs(center - start) <= maxEdits * 2)) continue;
    if (centers.length >= MAX_ALIGNMENT_CENTERS) return null;
    centers.push(start);
  }
  const starts = new Set<number>();
  for (const center of centers) {
    for (let delta = -maxEdits; delta <= maxEdits; delta += 1) {
      const start = center + delta;
      if (start >= 0 && start < reference.length) starts.add(start);
    }
  }
  return starts;
}

function alignText(source: readonly MatchPoint[], targetWindow: readonly MatchPoint[], maxEdits: number): TextAlignment {
  const rows = source.length + 1;
  const columns = targetWindow.length + 1;
  const infinity = maxEdits + 1;
  const costs = Array.from({ length: rows }, () => {
    const row = new Uint8Array(columns);
    row.fill(infinity);
    return row;
  });
  for (let column = 0; column <= Math.min(maxEdits, targetWindow.length); column += 1) costs[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    if (row <= maxEdits) costs[row][0] = row;
    const firstColumn = Math.max(1, row - maxEdits);
    const lastColumn = Math.min(targetWindow.length, row + maxEdits);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const substitution = costs[row - 1][column - 1] + (source[row - 1].value === targetWindow[column - 1].value ? 0 : 1);
      costs[row][column] = Math.min(infinity,
        substitution,
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
      );
    }
  }

  const minEnd = Math.max(0, source.length - maxEdits);
  const maxEnd = Math.min(targetWindow.length, source.length + maxEdits);
  let endColumn = minEnd;
  for (let column = minEnd + 1; column <= maxEnd; column += 1) {
    if (costs[source.length][column] < costs[source.length][endColumn]) endColumn = column;
  }

  const replacements = new Map<number, string>();
  const distance = costs[source.length][endColumn];
  if (distance > maxEdits) return { distance, replacements };

  let row = source.length;
  let column = endColumn;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0) {
      const substitutionCost = source[row - 1].value === targetWindow[column - 1].value ? 0 : 1;
      if (costs[row][column] === costs[row - 1][column - 1] + substitutionCost) {
        if (substitutionCost || isLatinCaseMismatch(source[row - 1], targetWindow[column - 1])) {
          replacements.set(row - 1, targetWindow[column - 1].original);
        }
        row -= 1;
        column -= 1;
        continue;
      }
    }
    if (row > 0 && costs[row][column] === costs[row - 1][column] + 1) {
      row -= 1;
      continue;
    }
    column -= 1;
  }

  return { distance, replacements };
}

function removeReorderedReplacementSpans(source: readonly MatchPoint[], replacements: Map<number, string>) {
  const filtered = new Map(replacements);
  const offsets = [...replacements.keys()].sort((left, right) => left - right);
  let start = 0;

  while (start < offsets.length) {
    let end = start + 1;
    while (end < offsets.length && offsets[end] - offsets[end - 1] <= 2) end += 1;
    const run = offsets.slice(start, end);
    if (run.length >= 2) {
      const spanStart = run[0];
      const spanEnd = run.at(-1) ?? spanStart;
      const original = source.slice(spanStart, spanEnd + 1).map((point) => point.value).sort().join('');
      const replacement = source.slice(spanStart, spanEnd + 1)
        .map((point, index) => (replacements.get(spanStart + index) || point.original).toLowerCase())
        .sort()
        .join('');
      if (original === replacement) for (const offset of run) filtered.delete(offset);
    }
    start = end;
  }

  return filtered;
}

function isReorderedInsteadOfCorrected(source: readonly MatchPoint[], replacements: ReadonlyMap<number, string>) {
  const original = source.map((point) => point.value);
  const corrected = source.map((point, offset) => {
    const replacement = replacements.get(offset);
    if (!replacement) return point.value;
    const normalized = Array.from(replacement.normalize('NFKC').toLowerCase());
    return normalized.length === 1 ? normalized[0] : replacement;
  });
  if (original.every((character, index) => character === corrected[index])) return false;
  if (original.length !== corrected.length) return false;
  const originalMultiset = [...original].sort();
  const correctedMultiset = [...corrected].sort();
  return originalMultiset.every((character, index) => character === correctedMultiset[index]);
}

function findCorrections(source: readonly MatchPoint[], reference: readonly MatchPoint[], index: Map<string, number[]>) {
  const maxEdits = Math.max(1, Math.floor(source.length * MAX_EDIT_RATIO));
  const starts = candidateStarts(source, reference, index, maxEdits);
  if (!starts?.size) return new Map<number, string>();
  let bestDistance = maxEdits + 1;
  let bestSignature: string | null = null;
  let ambiguous = false;
  let bestReplacements = new Map<number, string>();

  for (const start of starts) {
    const targetWindow = reference.slice(start, start + source.length + maxEdits);
    if (targetWindow.length < source.length - maxEdits) continue;
    const alignment = alignText(source, targetWindow, maxEdits);
    if (alignment.distance > maxEdits) continue;
    const signature = [...alignment.replacements]
      .sort(([left], [right]) => left - right)
      .map(([offset, character]) => `${offset}:${character}`)
      .join('|');

    if (alignment.distance < bestDistance) {
      bestDistance = alignment.distance;
      bestSignature = signature;
      bestReplacements = alignment.replacements;
      ambiguous = false;
    } else if (alignment.distance === bestDistance && signature !== bestSignature) {
      ambiguous = true;
    }
  }

  if (bestDistance > maxEdits || ambiguous || !bestReplacements.size) return new Map<number, string>();
  if (isReorderedInsteadOfCorrected(source, bestReplacements)) return new Map<number, string>();
  return removeReorderedReplacementSpans(source, bestReplacements);
}

function replacementProposals(segments: readonly TimestampedTranscriptSegment[], referenceText: string) {
  const reference = referencePoints(referenceText);
  const segmentPoints = segments.map((segment) => matchPoints(segment.text));
  const ranges: SegmentRange[] = [];
  let total = 0;
  for (const points of segmentPoints) {
    ranges.push({ start: total, end: total + points.length });
    total += points.length;
  }
  if (total < MIN_ALIGNMENT_CHARS || reference.length < MIN_ALIGNMENT_CHARS) return new Map<number, string>();

  const flattened = segmentPoints.flat();
  const index = buildNgramIndex(reference);
  const proposals = new Map<number, Set<string>>();
  let firstSegment = 0;

  while (firstSegment < segments.length) {
    let lastSegment = firstSegment;
    while (lastSegment < segments.length && ranges[lastSegment].end - ranges[firstSegment].start < MAX_ALIGNMENT_CHARS) lastSegment += 1;
    if (lastSegment === firstSegment) lastSegment += 1;
    const start = ranges[firstSegment].start;
    const end = ranges[lastSegment - 1].end;
    const source = flattened.slice(start, end);
    if (source.length >= MIN_ALIGNMENT_CHARS) {
      for (const [offset, character] of findCorrections(source, reference, index)) {
        const globalOffset = start + offset;
        const candidates = proposals.get(globalOffset) || new Set<string>();
        candidates.add(character);
        proposals.set(globalOffset, candidates);
      }
    }
    if (lastSegment >= segments.length) break;
    firstSegment = Math.max(firstSegment + 1, lastSegment - 2);
  }

  return new Map([...proposals]
    .filter(([, candidates]) => candidates.size === 1)
    .map(([offset, candidates]) => [offset, [...candidates][0]]));
}

function patchText(value: string, startOffset: number, replacements: ReadonlyMap<number, string>) {
  let matchOffset = 0;
  return Array.from(value, (character) => {
    if (!isMatchable(character)) return character;
    const replacement = replacements.get(startOffset + matchOffset);
    matchOffset += 1;
    return replacement || character;
  }).join('');
}

function patchWords(words: readonly TimestampedTranscriptWord[] | undefined, startOffset: number, replacements: ReadonlyMap<number, string>) {
  if (!words) return undefined;
  let matchOffset = startOffset;
  return words.map((word) => {
    const text = patchText(word.text, matchOffset, replacements);
    matchOffset += matchPoints(word.text).length;
    return text === word.text ? word : { ...word, text };
  });
}

function referencePunctuationBoundaries(referenceText: string) {
  const documentText = referenceText.replace(/^\s*\[[^\]\r\n]{1,160}\]\s*/gmu, '');
  const points: string[] = [];
  const boundaries: Array<{ position: number; punctuation: string }> = [];
  for (const character of Array.from(documentText)) {
    const normalized = matchPoints(character);
    if (normalized.length) {
      points.push(...normalized.map((point) => point.value));
    } else if (REFERENCE_PUNCTUATION.test(character) && points.length) {
      boundaries.push({ position: points.length, punctuation: character });
    }
  }
  return { points, boundaries };
}

function transcriptPoints(words: readonly TimestampedTranscriptWord[]) {
  const points: TranscriptPoint[] = [];
  words.forEach((word, wordIndex) => {
    Array.from(word.text).forEach((character, charIndex) => {
      for (const point of matchPoints(character)) points.push({ value: point.value, wordIndex, charIndex });
    });
  });
  return points;
}

function findUniquePunctuationPosition(source: readonly TranscriptPoint[], reference: readonly string[], boundary: number) {
  for (let anchorLength = Math.min(10, boundary); anchorLength >= 5; anchorLength -= 1) {
    const anchorStart = boundary - anchorLength;
    const anchor = reference.slice(anchorStart, boundary);
    let referenceOccurrences = 0;
    for (let referenceStart = 0; referenceStart + anchorLength <= reference.length; referenceStart += 1) {
      if (anchor.every((character, offset) => reference[referenceStart + offset] === character)) referenceOccurrences += 1;
      if (referenceOccurrences > 1) break;
    }
    if (referenceOccurrences !== 1) continue;
    const matches: number[] = [];
    for (let sourceStart = 0; sourceStart + anchorLength <= source.length; sourceStart += 1) {
      if (anchor.every((character, offset) => source[sourceStart + offset].value === character)) {
        matches.push(sourceStart + anchorLength);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const following = reference.slice(boundary, boundary + 5);
      if (!following.length) return undefined;
      const contextualMatches = matches.filter((position) => (
        following.every((character, offset) => source[position + offset]?.value === character)
      ));
      if (contextualMatches.length === 1) return contextualMatches[0];
      return undefined;
    }
  }
  return undefined;
}

function splitTranscriptWordAtPunctuation(
  word: TimestampedTranscriptWord,
  marks: ReadonlyMap<number, readonly string[]>,
) {
  const characters = Array.from(word.text);
  const internalOffsets = [...marks.keys()].filter((offset) => offset > 0 && offset < characters.length).sort((left, right) => left - right);
  const pieces: string[] = [];
  let cursor = 0;
  for (const offset of internalOffsets) {
    const source = characters.slice(cursor, offset).join('');
    const text = (cursor > 0 ? source.replace(/^[，,。.!?！？；;：:]+/u, '') : source)
      .replace(/[，,。.!?！？；;：:]+$/u, '');
    const punctuation = marks.get(offset) || [];
    pieces.push(`${text.replace(/\s+$/u, '')}${punctuation.join('')}`);
    cursor = offset;
  }
  const sourceTail = characters.slice(cursor).join('');
  const tail = (cursor > 0 ? sourceTail.replace(/^[，,。.!?！？；;：:]+/u, '') : sourceTail)
    .replace(/[，,。.!?！？；;：:]+$/u, '');
  const endingMarks = marks.get(characters.length) || [];
  pieces.push(`${tail.replace(/\s+$/u, '')}${endingMarks.join('')}`);
  if (pieces.length === 1) return [{ ...word, text: pieces[0] }];

  const weights = pieces.map((piece) => Math.max(1, matchPoints(piece).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0, word.end - word.start);
  let elapsedWeight = 0;
  return pieces.map((text, index) => {
    const start = word.start + duration * elapsedWeight / totalWeight;
    elapsedWeight += weights[index];
    const end = index === pieces.length - 1
      ? word.end
      : word.start + duration * elapsedWeight / totalWeight;
    return { start: roundTimestamp(start), end: roundTimestamp(end), text };
  });
}

/** Apply reference punctuation only where a unique local text anchor exists. */
export function projectReferencePunctuation(words: readonly TimestampedTranscriptWord[], referenceText?: string) {
  if (!referenceText?.trim() || !words.length) return words;
  const { points: reference, boundaries } = referencePunctuationBoundaries(referenceText);
  const source = transcriptPoints(words);
  if (source.length < 10 || !boundaries.length) return words;

  const marksByWord = new Map<number, Map<number, string[]>>();
  for (const boundary of boundaries) {
    if (boundary.position < 5 || boundary.position >= reference.length) continue;
    const position = findUniquePunctuationPosition(source, reference, boundary.position);
    if (position === undefined || position <= 0 || position >= source.length) continue;
    const left = source[position - 1];
    const right = source[position];
    const wordIndex = left.wordIndex;
    const word = words[wordIndex];
    const offset = left.wordIndex === right.wordIndex
      ? left.charIndex + 1
      : Array.from(word.text).length;
    const marks = marksByWord.get(wordIndex) || new Map<number, string[]>();
    const atOffset = marks.get(offset) || [];
    if (!atOffset.includes(boundary.punctuation)) atOffset.push(boundary.punctuation);
    marks.set(offset, atOffset);
    marksByWord.set(wordIndex, marks);
  }

  if (!marksByWord.size) return words;
  const projected = words.flatMap((word, index) => {
    const marks = marksByWord.get(index);
    return marks ? splitTranscriptWordAtPunctuation(word, marks) : [word];
  });
  let changed = false;
  const normalized = projected.map((word, index) => {
    const original = words[index];
    if (original && /[，,。.!?！？；;：:]$/u.test(original.text) && word.text === original.text) return word;
    const text = word.text.replace(/([，,。.!?！？；;：:])\s+/gu, '$1').replace(/([，,。.!?！？；;：:])\1+/gu, '$1');
    if (text !== word.text) changed = true;
    return text === word.text ? word : { ...word, text };
  });
  return changed ? normalized : projected;
}

/** Correct only same-length character substitutions supported by a strong local script match. */
export function correctTranscriptWithReference(result: LocalTranscriptionResult, referenceText?: string): LocalTranscriptionResult {
  if (!referenceText?.trim() || !result.segments.length) return result;
  const replacements = replacementProposals(result.segments, referenceText);
  if (!replacements.size) return result;

  let offset = 0;
  const segments = result.segments.map((segment) => {
    const start = offset;
    offset += matchPoints(segment.text).length;
    const text = patchText(segment.text, start, replacements);
    const words = patchWords(segment.words, start, replacements);
    return text === segment.text && words === segment.words
      ? segment
      : { ...segment, text, ...(words ? { words } : {}) };
  });

  const words = patchWords(result.words, 0, replacements) || [];
  const text = matchPoints(result.text).length === offset
    ? patchText(result.text, 0, replacements)
    : result.text;
  return { ...result, text, segments, words };
}

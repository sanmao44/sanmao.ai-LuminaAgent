/**
 * The common reference representation used by every creative composer.
 *
 * Keep this module free of React and browser APIs.  Apart from making the
 * client/server boundary easier to audit, the pure helpers are also useful
 * for restoring old conversations and for testing paste/mention behaviour.
 */
export type CreativeReferenceKind = "image" | "video" | "text";

/** Canvas may carry audio as a video-only input. */
export type CreativeReferenceLikeKind = CreativeReferenceKind | "audio";

export type CreativeReferenceLike = {
  id: string;
  kind: CreativeReferenceLikeKind;
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  pending?: boolean;
  error?: string;
};

export type CreativeReference = {
  id: string;
  kind: CreativeReferenceKind;
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  nodeId?: string;
  width?: number;
  height?: number;
  pending?: boolean;
  error?: string;
};

export type LegacyCreativeReference = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  url?: unknown;
  dataUrl?: unknown;
  text?: unknown;
  content?: unknown;
  mimeType?: unknown;
  nodeId?: unknown;
  width?: unknown;
  height?: unknown;
  pending?: unknown;
};

export type ReferenceMentionRange = { start: number; end: number; query: string };

const imageDataPattern = /^data:image\//i;
const videoDataPattern = /^data:video\//i;

function stringValue(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function kindFromValue(value: unknown, url: string, mimeType: string, text: string): CreativeReferenceKind {
  if (value === "image" || value === "video" || value === "text") return value;
  if (text && !url) return "text";
  if (/^video\//i.test(mimeType) || videoDataPattern.test(url)) return "video";
  return "image";
}

/** Normalize both the new wire shape and historical image-only records. */
export function normalizeCreativeReference(
  value: unknown,
  index = 0,
  options: { maxTextLength?: number } = {},
): CreativeReference | null {
  if (typeof value === "string") {
    const url = value.trim();
    if (!url) return null;
    return { id: `legacy-ref-${index + 1}`, kind: "image", name: `参考图 ${index + 1}`, url };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as LegacyCreativeReference;
  const url = stringValue(raw.url || raw.dataUrl, 2_000_000);
  const text = stringValue(raw.text || raw.content, options.maxTextLength ?? 700_000);
  const mimeType = stringValue(raw.mimeType, 120) || undefined;
  const kind = kindFromValue(raw.kind, url, mimeType || "", text);
  if (kind === "text" && !text) return null;
  if (kind !== "text" && !url) return null;
  const id = stringValue(raw.id, 160) || `ref-${index + 1}`;
  const name = stringValue(raw.name, 160) || (kind === "image" ? `参考图 ${index + 1}` : kind === "video" ? `参考视频 ${index + 1}` : `文本 ${index + 1}`);
  const width = positiveNumber(raw.width);
  const height = positiveNumber(raw.height);
  return {
    id,
    kind,
    name,
    ...(url ? { url } : {}),
    ...(text ? { text } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(stringValue(raw.nodeId, 160) ? { nodeId: stringValue(raw.nodeId, 160) } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(raw.pending === true ? { pending: true } : {}),
  };
}

export function normalizeCreativeReferences(input: unknown, max = 16): CreativeReference[] {
  if (!Array.isArray(input)) return [];
  const result: CreativeReference[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length && result.length < Math.max(1, Math.min(64, max)); index += 1) {
    const reference = normalizeCreativeReference(input[index], index);
    if (!reference) continue;
    const key = reference.id || `${reference.kind}:${reference.url || reference.text || index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

export function reorderCreativeReferences<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return items;
  next.splice(toIndex, 0, moved);
  return next;
}

/** Return the active @query at a textarea cursor, if there is one.
 *
 * An @ mention is an inline editing affordance, so it may start after any
 * character.  Restricting the preceding character to whitespace made the
 * menu work only at the beginning of a sentence (or after a manually added
 * space), which is especially surprising in Chinese text where words are
 * commonly written without spaces.
 */
export function referenceMentionRange(value: string, cursor = value.length): ReferenceMentionRange | null {
  const safeCursor = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : value.length, value.length));
  const before = value.slice(0, safeCursor);
  const match = /@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const token = `@${match[1]}`;
  return { start: safeCursor - token.length, end: safeCursor, query: match[1] };
}

export function hasReferenceMentions(value: string) {
  return /@[0-9]+\b/.test(value);
}

export function referenceMentionNumbers(value: string) {
  return [...String(value || "").matchAll(/@([0-9]+)\b/g)].map((match) => Number(match[1]));
}

export function invalidReferenceMentionNumbers(value: string, references: readonly CreativeReference[]) {
  const max = references.length;
  return Array.from(new Set(referenceMentionNumbers(value).filter((number) => number < 1 || number > max)));
}

export function insertReferenceMention(
  value: string,
  cursor: number,
  index: number,
  suffix = " ",
) {
  const range = referenceMentionRange(value, cursor);
  const start = range?.start ?? Math.max(0, Math.min(cursor, value.length));
  const token = `@${index + 1}${suffix}`;
  return { value: `${value.slice(0, start)}${token}${value.slice(range?.end ?? start)}`, cursor: start + token.length };
}

function chineseNumber(value: string) {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] || 0);
  if (value.endsWith("十")) return (digits[value[0]] || 0) * 10;
  if (value.includes("十")) return (digits[value[0]] || 0) * 10 + (digits[value.slice(2)] || 0);
  return digits[value];
}

/**
 * Turn prose such as “图片1转场到图片2，最后转场到图片3” into explicit
 * mentions.  Only labels that resolve to an existing reference are changed;
 * unrelated prose remains untouched so paste never destroys user content.
 */
export function replaceNaturalReferenceLabels<T extends CreativeReferenceLike>(value: string, references: readonly T[]) {
  const unresolved: string[] = [];
  let replaced = false;
  const patterns = [
    /((?:参考|原始|输入|素材|图片|图|视频|Image|image|Video|video)\s*)(\d+|[一二两三四五六七八九十]+)(?![\d])/gi,
  ];
  let output = value;
  for (const pattern of patterns) {
    output = output.replace(pattern, (full, prefix: string, rawNumber: string, offset: number, source: string) => {
      const after = source.slice(offset + full.length);
      const before = source.slice(0, offset);
      const isModelLabel = /image/i.test(prefix) && (
        /^\.\d/.test(after) ||
        /\b(?:gpt|openai)\s*[-:]?\s*$/i.test(before)
      );
      if (isModelLabel) return full;
      const number = chineseNumber(rawNumber);
      const isVideoLabel = /视频|video/i.test(prefix);
      const index = Number(number) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= references.length) {
        if (rawNumber) unresolved.push(full.trim());
        return full;
      }
      const reference = references[index];
      if (isVideoLabel && reference.kind !== "video") return full;
      replaced = true;
      return `@${index + 1}`;
    });
  }
  return { value: output, replaced, unresolved: Array.from(new Set(unresolved)) };
}

export type ReferenceSelection<T extends CreativeReferenceLike = CreativeReference> = {
  references: T[];
  invalidNumbers: number[];
  hasMentions: boolean;
};

/** With mentions select exactly those records; without mentions preserve legacy all-input behaviour. */
export function selectCreativeReferences<T extends CreativeReferenceLike>(value: string, available: readonly T[]): ReferenceSelection<T> {
  const numbers = referenceMentionNumbers(value);
  const hasMentions = numbers.length > 0;
  // When there are no current references, @1-style text is ordinary prompt
  // content (there is nothing it could resolve to). Only validate mention
  // bounds when a reference list exists; this keeps text-only requests
  // sendable instead of rejecting every numeric @ token.
  const invalidNumbers = available.length
    ? Array.from(new Set(numbers.filter((number) => number < 1 || number > available.length)))
    : [];
  if (!hasMentions) return { references: [...available], invalidNumbers, hasMentions };
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const number of numbers) {
    const reference = available[number - 1];
    if (reference && !seen.has(reference.id)) {
      selected.push(reference);
      seen.add(reference.id);
    }
  }
  return { references: selected, invalidNumbers, hasMentions };
}

export type CreativeReferenceRoleResolution<T extends CreativeReferenceLike = CreativeReference> = ReferenceSelection<T> & {
  /** References used only to derive the output canvas size, never sent as images. */
  layoutOnlyReferences: T[];
  layoutOnlyNumbers: number[];
  /** Exact reduced aspect ratio derived from layout-only image dimensions. */
  layoutAspectRatio?: string;
  layoutAspectRatioConflict: boolean;
  layoutDimensionsMissingReferences: T[];
  /** Prompt with layout-only mentions replaced by explicit output-size language. */
  prompt: string;
};

const layoutCuePattern = /(?:比例|画幅|宽高比|长宽比|尺寸|分辨率|横版|竖版|横向|纵向|aspect\s*ratio|ratio|dimensions?|resolution|landscape|portrait|width|height)/i;
const visualCuePattern = /(?:风格|元素|主体|内容|画面|构图|色彩|颜色|色调|建筑|人物|类似|复刻|重现|style|elements?|subject|content|visual|composition|color|similar|recreate|copy)/i;
const clauseBoundaryPattern = /[\r\n，。！？；、,.;!?]/;
const broadReplacementSubjectPattern = /(?:全部|所有|任何|元素|画面|视觉|场景|地域|地名|文字|主体|建筑|内容)/i;
const broadReplacementActionPattern = /(?:替换|换成|改成|改为|变成|不能|不得|不要|禁止|不出现|移除|去掉|避免)/i;

function hasBroadReplacementIntent(value: string) {
  const subjectThenAction = new RegExp(`${broadReplacementSubjectPattern.source}[^，。！？；\\n]{0,18}${broadReplacementActionPattern.source}`, "i");
  const actionThenSubject = new RegExp(`${broadReplacementActionPattern.source}[^，。！？；\\n]{0,18}${broadReplacementSubjectPattern.source}`, "i");
  return subjectThenAction.test(value) || actionThenSubject.test(value);
}

function referenceMentionClause(value: string, start: number, end: number) {
  let clauseStart = start;
  while (clauseStart > 0 && !clauseBoundaryPattern.test(value[clauseStart - 1])) clauseStart -= 1;
  let clauseEnd = end;
  while (clauseEnd < value.length && !clauseBoundaryPattern.test(value[clauseEnd])) clauseEnd += 1;
  return value.slice(clauseStart, clauseEnd);
}

function isLayoutOnlyMention(value: string, start: number, end: number) {
  const clause = referenceMentionClause(value, start, end);
  return layoutCuePattern.test(clause) && !visualCuePattern.test(clause);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

function exactAspectRatio(reference: CreativeReferenceLike) {
  const width = positiveNumber(reference.width);
  const height = positiveNumber(reference.height);
  if (width === undefined || height === undefined) return "";
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

function aspectRatioLabel(reference: CreativeReferenceLike) {
  const width = positiveNumber(reference.width);
  const height = positiveNumber(reference.height);
  if (width === undefined || height === undefined) return "";
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return "";
  const exact = exactAspectRatio(reference) || `${ratio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}:1`;
  return `${exact}（约 ${ratio.toFixed(3)}:1）`;
}

function referencePromptLabel(reference: CreativeReferenceLike, number: number) {
  const label = reference.kind === "text"
    ? "引用文本"
    : reference.kind === "video"
      ? "参考视频"
      : "视觉参考图";
  return `${label}${number}`;
}

function rewriteResolvedReferenceMentions<T extends CreativeReferenceLike>(
  value: string,
  available: readonly T[],
  layoutOnlyNumbers: readonly number[],
  visualReferenceIndexes: ReadonlyMap<string, number>,
) {
  const layoutNumbers = new Set(layoutOnlyNumbers);
  const constraints: string[] = [];
  const replacementIntent = hasBroadReplacementIntent(value);
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(/@([0-9]+)\b/g)) {
    const number = Number(match[1]);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const reference = available[number - 1];
    if (!reference) continue;
    output += value.slice(cursor, start);
    if (isLayoutOnlyMention(value, start, end)) {
      const ratio = aspectRatioLabel(reference);
      output += ratio || "参考图的宽高比";
    } else {
      const referenceIndex = visualReferenceIndexes.get(reference.id) || number;
      output += referencePromptLabel(reference, referenceIndex);
      if (replacementIntent) {
        output += "（仅参考构图、排版和整体风格；不要复制参考图中的文字、地名、主体、建筑或可识别元素；最终内容以提示词指定的新版本为准）";
      }
    }
    cursor = end;
    if (layoutNumbers.has(number)) {
      const ratio = aspectRatioLabel(reference);
      constraints.push(
        ratio
          ? `第${number}张素材只提供画幅比例 ${ratio}`
          : `第${number}张素材只提供画幅比例`,
      );
    }
  }
  output += value.slice(cursor);
  const directives: string[] = [];
  if (constraints.length) {
    directives.push(`画幅约束：${constraints.join("；")}。这些素材只提供宽高比，不是视觉参考；不要读取其中的主体、构图、风格、颜色、建筑、人物或其他画面元素。`);
  }
  if (replacementIntent && visualReferenceIndexes.size) {
    directives.push("视觉参考图只用于构图、排版和整体风格；必须替换其中的具体文字、地名、主体、建筑和可识别元素，最终内容以提示词指定的新版本为准。");
  }
  return [output.trim(), ...directives].filter(Boolean).join("\n\n");
}

/** Resolve mentions whose role is layout-only before image references reach a provider. */
export function resolveCreativeReferenceRoles<T extends CreativeReferenceLike>(
  value: string,
  available: readonly T[],
): CreativeReferenceRoleResolution<T> {
  const selection = selectCreativeReferences(value, available);
  const mentionGroups = new Map<number, { start: number; end: number; layoutOnly: boolean }[]>();
  for (const match of String(value || "").matchAll(/@([0-9]+)\b/g)) {
    const number = Number(match[1]);
    if (number < 1 || number > available.length) continue;
    const start = match.index ?? 0;
    const mentions = mentionGroups.get(number) || [];
    mentions.push({ start, end: start + match[0].length, layoutOnly: isLayoutOnlyMention(value, start, start + match[0].length) });
    mentionGroups.set(number, mentions);
  }
  const layoutOnlyNumbers = [...mentionGroups.entries()]
    .filter(([, mentions]) => mentions.length > 0 && mentions.every((mention) => mention.layoutOnly))
    .map(([number]) => number);
  const layoutIds = new Set(
    layoutOnlyNumbers
      .map((number) => available[number - 1]?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const layoutOnlyReferences = selection.references.filter((reference) => layoutIds.has(reference.id));
  const references = selection.references.filter((reference) => !layoutIds.has(reference.id));
  const layoutDimensionsMissingReferences = layoutOnlyReferences.filter((reference) => !exactAspectRatio(reference));
  const aspectRatios = new Set(layoutOnlyReferences.map(exactAspectRatio).filter(Boolean));
  const layoutAspectRatioConflict = aspectRatios.size > 1;
  const layoutAspectRatio = layoutDimensionsMissingReferences.length || layoutAspectRatioConflict
    ? undefined
    : [...aspectRatios][0];
  const visualReferenceIndexes = new Map(references.map((reference, index) => [reference.id, index + 1]));
  return {
    ...selection,
    references,
    layoutOnlyReferences,
    layoutOnlyNumbers,
    layoutAspectRatio,
    layoutAspectRatioConflict,
    layoutDimensionsMissingReferences,
    prompt: rewriteResolvedReferenceMentions(value, available, layoutOnlyNumbers, visualReferenceIndexes),
  };
}

export function referencePreviewText(reference: CreativeReference, max = 96) {
  return String(reference.text || "").replace(/\s+/g, " ").trim().slice(0, max) || reference.name;
}

export function creativeReferenceUrl(reference: { dataUrl?: unknown; url?: unknown } | null | undefined) {
  return typeof reference?.dataUrl === "string" && reference.dataUrl
    ? reference.dataUrl
    : typeof reference?.url === "string"
      ? reference.url
      : "";
}

export function referenceTextBadge(reference: { name?: unknown }) {
  const name = String(reference?.name || "");
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return /^[a-z0-9]{1,5}$/i.test(extension) ? extension.toUpperCase() : "TXT";
}

export function referenceMentionOptions(references: readonly CreativeReferenceLike[] | null | undefined) {
  return (references || []).map((reference, index) => ({
    id: reference.id || `reference-${index + 1}`,
    kind: reference.kind === "audio" ? "video" : reference.kind || "image",
    name: reference.name || `引用素材 ${index + 1}`,
    url: creativeReferenceUrl(reference),
    text: reference.text,
  }));
}

export function appendTextReferenceContext<T extends CreativeReferenceLike>(prompt: string, references: readonly T[]) {
  const textReferences = references.filter((reference) => reference.kind === "text" && reference.text?.trim());
  if (!textReferences.length) return prompt;
  return `${prompt.trim()}\n\n${textReferences.map((reference) => `[引用文本：${reference.name}]\n${reference.text}`).join("\n\n")}`.trim();
}

export function referenceToAgentPayload(reference: CreativeReference) {
  return {
    id: reference.id,
    kind: reference.kind,
    name: reference.name,
    ...(reference.url ? { url: reference.url } : {}),
    ...(reference.text ? { text: reference.text } : {}),
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
  };
}

export function isUsableReference(reference: CreativeReference) {
  if (reference.pending || reference.error) return false;
  return reference.kind === "text" ? Boolean(reference.text?.trim()) : Boolean(reference.url?.trim());
}

export function isImageDataUrl(value: string) { return imageDataPattern.test(value); }

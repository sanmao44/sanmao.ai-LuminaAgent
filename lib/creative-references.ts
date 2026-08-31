/**
 * The common reference representation used by every creative composer.
 *
 * Keep this module free of React and browser APIs.  Apart from making the
 * client/server boundary easier to audit, the pure helpers are also useful
 * for restoring old conversations and for testing paste/mention behaviour.
 */
export type CreativeReferenceKind = "image" | "video" | "text";

export type CreativeReference = {
  id: string;
  kind: CreativeReferenceKind;
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  nodeId?: string;
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
  pending?: unknown;
};

export type ReferenceMentionRange = { start: number; end: number; query: string };

const imageDataPattern = /^data:image\//i;
const videoDataPattern = /^data:video\//i;

function stringValue(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
  return {
    id,
    kind,
    name,
    ...(url ? { url } : {}),
    ...(text ? { text } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(stringValue(raw.nodeId, 160) ? { nodeId: stringValue(raw.nodeId, 160) } : {}),
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

/** Return the active @query at a textarea cursor, if there is one. */
export function referenceMentionRange(value: string, cursor = value.length): ReferenceMentionRange | null {
  const safeCursor = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : value.length, value.length));
  const before = value.slice(0, safeCursor);
  const match = /(^|[\s([\u3000])@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const token = `@${match[2]}`;
  return { start: safeCursor - token.length, end: safeCursor, query: match[2] };
}

export function hasReferenceMentions(value: string) {
  return /(?:^|[\s([\u3000])@[0-9]+\b/.test(value);
}

export function referenceMentionNumbers(value: string) {
  return [...String(value || "").matchAll(/(?:^|[^\w])@([0-9]+)\b/g)].map((match) => Number(match[1]));
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
export function replaceNaturalReferenceLabels(value: string, references: readonly CreativeReference[]) {
  const unresolved: string[] = [];
  let replaced = false;
  const patterns = [
    /((?:参考|原始|输入|素材|图片|图|视频|Image|image|Video|video)\s*)(\d+|[一二两三四五六七八九十]+)(?![\d])/gi,
  ];
  let output = value;
  for (const pattern of patterns) {
    output = output.replace(pattern, (full, prefix: string, rawNumber: string) => {
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

export type ReferenceSelection = {
  references: CreativeReference[];
  invalidNumbers: number[];
  hasMentions: boolean;
};

/** With mentions select exactly those records; without mentions preserve legacy all-input behaviour. */
export function selectCreativeReferences(value: string, available: readonly CreativeReference[]): ReferenceSelection {
  const numbers = referenceMentionNumbers(value);
  const hasMentions = numbers.length > 0;
  const invalidNumbers = Array.from(new Set(numbers.filter((number) => number < 1 || number > available.length)));
  if (!hasMentions) return { references: [...available], invalidNumbers, hasMentions };
  const selected: CreativeReference[] = [];
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

export function referencePreviewText(reference: CreativeReference, max = 96) {
  return String(reference.text || "").replace(/\s+/g, " ").trim().slice(0, max) || reference.name;
}

export function appendTextReferenceContext(prompt: string, references: readonly CreativeReference[]) {
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

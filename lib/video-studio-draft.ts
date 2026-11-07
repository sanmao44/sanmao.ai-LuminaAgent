export type VideoStudioDraftInput = {
  prompt: string;
  modelId: string;
  operation: 'generate' | 'edit' | 'extend';
  inputMode: 'text' | 'first-frame' | 'frames' | 'reference';
  seconds: number;
  ratio: string;
  resolution: string;
  agnesWidth: number;
  agnesHeight: number;
  agnesNumFrames: number;
  agnesFrameRate: number;
  hasUnpersistedMedia: boolean;
};

export type VideoStudioDraft = VideoStudioDraftInput & {
  version: 1;
  savedAt: number;
};

export function hasVideoStudioDraftContent(draft: VideoStudioDraftInput, defaultModelId = 'auto'): boolean {
  return Boolean(
    draft.prompt.trim()
    || draft.modelId !== defaultModelId
    || draft.operation !== 'generate'
    || draft.inputMode !== 'text'
    || draft.seconds !== 5
    || draft.ratio !== '16:9'
    || draft.resolution !== '720p'
    || draft.agnesWidth !== 1152
    || draft.agnesHeight !== 768
    || draft.agnesNumFrames !== 81
    || draft.agnesFrameRate !== 24
    || draft.hasUnpersistedMedia,
  );
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'sanmao.video-studio-draft.v1';
const MAX_SERIALIZED_LENGTH = 20_000;
const RATIOS = new Set(['auto', '21:9', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']);
const OPERATIONS = new Set(['generate', 'edit', 'extend']);
const INPUT_MODES = new Set(['text', 'first-frame', 'frames', 'reference']);
const INLINE_MEDIA_DATA_URL = /data:(?:image|video|audio)\/[^;,\s]+;base64,/i;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function normalizeDraft(value: unknown): VideoStudioDraft | null {
  if (!isRecord(value) || value.version !== 1 || !Number.isFinite(value.savedAt) || typeof value.savedAt !== 'number') return null;
  if (typeof value.prompt !== 'string' || value.prompt.length > 6000 || INLINE_MEDIA_DATA_URL.test(value.prompt)) return null;

  const ratio = typeof value.ratio === 'string' && RATIOS.has(value.ratio) ? value.ratio : '16:9';
  const modelId = typeof value.modelId === 'string' && value.modelId.length > 0 && value.modelId.length <= 240 ? value.modelId : 'auto';
  const operation = typeof value.operation === 'string' && OPERATIONS.has(value.operation)
    ? value.operation as VideoStudioDraftInput['operation']
    : 'generate';
  const inputMode = typeof value.inputMode === 'string' && INPUT_MODES.has(value.inputMode)
    ? value.inputMode as VideoStudioDraftInput['inputMode']
    : 'text';
  const agnesWidth = boundedInteger(value.agnesWidth, 1152, 64, 3840);
  const agnesHeight = boundedInteger(value.agnesHeight, 768, 64, 3840);
  const agnesNumFrames = boundedInteger(value.agnesNumFrames, 81, 1, 441);

  return {
    version: 1,
    savedAt: value.savedAt,
    prompt: value.prompt,
    modelId,
    operation,
    inputMode,
    seconds: boundedInteger(value.seconds, 5, 1, 60),
    ratio,
    resolution: typeof value.resolution === 'string' && value.resolution.length <= 20 ? value.resolution : '720p',
    agnesWidth: agnesWidth % 64 === 0 ? agnesWidth : 1152,
    agnesHeight: agnesHeight % 64 === 0 ? agnesHeight : 768,
    agnesNumFrames: (agnesNumFrames - 1) % 8 === 0 ? agnesNumFrames : 81,
    agnesFrameRate: boundedInteger(value.agnesFrameRate, 24, 1, 60),
    hasUnpersistedMedia: value.hasUnpersistedMedia === true || inputMode !== 'text',
  };
}

export function loadVideoStudioDraft(storage?: StorageLike | null): VideoStudioDraft | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_SERIALIZED_LENGTH) return null;
    return normalizeDraft(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveVideoStudioDraft(input: VideoStudioDraftInput, storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  const draft = normalizeDraft({ ...input, version: 1, savedAt: Date.now() });
  if (!draft) return false;
  try {
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_SERIALIZED_LENGTH) return false;
    target.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearVideoStudioDraft(storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

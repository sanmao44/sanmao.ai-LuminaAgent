export type ImageStudioWorkflow = 'generate' | 'upscale';

export type ImageStudioDraftInput = {
  prompt: string;
  workflow: ImageStudioWorkflow;
  hasUnpersistedReferences: boolean;
};

export type ImageStudioDraft = ImageStudioDraftInput & {
  version: 1;
  savedAt: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'sanmao.image-studio-draft.v1';
const MAX_SERIALIZED_LENGTH = 24_000;
const MAX_PROMPT_LENGTH = 16_000;
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

function normalizeDraft(value: unknown): ImageStudioDraft | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null;
  if (typeof value.prompt !== 'string' || value.prompt.length > MAX_PROMPT_LENGTH || INLINE_MEDIA_DATA_URL.test(value.prompt)) return null;

  return {
    version: 1,
    savedAt: value.savedAt,
    prompt: value.prompt,
    workflow: value.workflow === 'upscale' ? 'upscale' : 'generate',
    hasUnpersistedReferences: value.hasUnpersistedReferences === true,
  };
}

export function hasImageStudioDraftContent(draft: Pick<ImageStudioDraftInput, 'prompt' | 'workflow'>) {
  return Boolean(draft.prompt.trim() || draft.workflow !== 'generate');
}

export function loadImageStudioDraft(storage?: StorageLike | null): ImageStudioDraft | null {
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

export function saveImageStudioDraft(input: ImageStudioDraftInput, storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  const draft = normalizeDraft({ ...input, version: 1, savedAt: Date.now() });
  if (!draft) return false;
  if (!hasImageStudioDraftContent(draft)) return clearImageStudioDraft(target);

  try {
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_SERIALIZED_LENGTH) return false;
    target.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearImageStudioDraft(storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

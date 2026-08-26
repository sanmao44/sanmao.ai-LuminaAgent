export type ModelPreferenceContext = 'agent' | 'generate' | 'edit' | 'upscale' | 'angle';
export type ModelPreferenceMode = 'auto' | 'manual';

export type ModelLastCall = {
  context: ModelPreferenceContext;
  mode: ModelPreferenceMode;
  providerId: string | null;
  modelId: string | null;
  params: Record<string, unknown>;
  timestamp: number;
};

export type ModelPreferences = {
  favorites: string[];
  recent: string[];
  lastCalls: Partial<Record<ModelPreferenceContext, ModelLastCall>>;
};

const STORAGE_KEY = 'sanmao-model-preferences';
const CHANGE_EVENT = 'sanmao-model-preferences-change';
const MAX_RECENT = 8;
const contexts: ModelPreferenceContext[] = ['agent', 'generate', 'edit', 'upscale', 'angle'];

const emptyPreferences = (): ModelPreferences => ({ favorites: [], recent: [], lastCalls: {} });

function isContext(value: unknown): value is ModelPreferenceContext {
  return typeof value === 'string' && contexts.includes(value as ModelPreferenceContext);
}

function isMode(value: unknown): value is ModelPreferenceMode {
  return value === 'auto' || value === 'manual';
}

function cleanModelIds(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))] : [];
}

function safeParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') result[key] = item;
    else if (Array.isArray(item) && item.every((entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))) result[key] = item;
  }
  return result;
}

export function readModelPreferences(): ModelPreferences {
  if (typeof window === 'undefined') return emptyPreferences();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<ModelPreferences> | null;
    if (!parsed || typeof parsed !== 'object') return emptyPreferences();
    const lastCalls: ModelPreferences['lastCalls'] = {};
    for (const context of contexts) {
      const candidate = parsed.lastCalls?.[context];
      if (!candidate || typeof candidate !== 'object' || !isContext(candidate.context) || !isMode(candidate.mode)) continue;
      lastCalls[context] = {
        context: candidate.context,
        mode: candidate.mode,
        providerId: typeof candidate.providerId === 'string' ? candidate.providerId : null,
        modelId: typeof candidate.modelId === 'string' ? candidate.modelId : null,
        params: safeParams(candidate.params),
        timestamp: typeof candidate.timestamp === 'number' ? candidate.timestamp : 0,
      };
    }
    return { favorites: cleanModelIds(parsed.favorites), recent: cleanModelIds(parsed.recent).slice(0, MAX_RECENT), lastCalls };
  } catch {
    return emptyPreferences();
  }
}

function writeModelPreferences(value: ModelPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    window.dispatchEvent(new Event('sanmao-workspace-change'));
  } catch {}
}

export function getFavoriteModelIds() { return readModelPreferences().favorites; }
export function getRecentModelIds() { return readModelPreferences().recent; }
export function getLastModelCall(context: ModelPreferenceContext) { return readModelPreferences().lastCalls[context] || null; }

export function setModelFavorite(modelId: string, favorite: boolean) {
  const preferences = readModelPreferences();
  const favorites = new Set(preferences.favorites);
  if (favorite) favorites.add(modelId); else favorites.delete(modelId);
  writeModelPreferences({ ...preferences, favorites: [...favorites] });
}

export function recordModelCall(input: {
  context: ModelPreferenceContext;
  mode: ModelPreferenceMode;
  providerId?: string | null;
  modelId?: string | null;
  params?: Record<string, unknown>;
}) {
  const preferences = readModelPreferences();
  const modelId = input.modelId || null;
  const recent = modelId ? [modelId, ...preferences.recent.filter((id) => id !== modelId)].slice(0, MAX_RECENT) : preferences.recent;
  const lastCall: ModelLastCall = {
    context: input.context,
    mode: input.mode,
    providerId: input.providerId || null,
    modelId,
    params: safeParams(input.params),
    timestamp: Date.now(),
  };
  writeModelPreferences({ ...preferences, recent, lastCalls: { ...preferences.lastCalls, [input.context]: lastCall } });
}

export function clearModelPreferences() {
  writeModelPreferences(emptyPreferences());
}

export function subscribeModelPreferences(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => listener();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

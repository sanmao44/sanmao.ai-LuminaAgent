export type AssetReferenceKind = 'image' | 'video' | 'audio';

const FOLDER_BY_KIND: Record<AssetReferenceKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
};

function cleanRelativePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(trimmed)) return '';
  const normalized = trimmed.replace(/\\/g, '/');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return normalized;
}

export function normalizeAssetStorageKey(kind: AssetReferenceKind, value: unknown) {
  const relative = cleanRelativePath(String(value || ''));
  if (!relative) return undefined;
  const folder = FOLDER_BY_KIND[kind];
  return relative === folder || relative.startsWith(`${folder}/`) ? relative : undefined;
}

/** Converts the current local storage URL to a portable logical reference. */
export function storageKeyFromAssetUrl(kind: AssetReferenceKind, url: unknown) {
  try {
    const parsed = new URL(String(url || ''), 'http://sanmao.local');
    const name = parsed.searchParams.get('name');
    if (!name || !parsed.pathname.includes('/api/storage/')) return undefined;
    return normalizeAssetStorageKey(kind, `${FOLDER_BY_KIND[kind]}/${name}`);
  } catch {
    return undefined;
  }
}

export function portableAssetReference(kind: AssetReferenceKind, value: { assetId?: unknown; storageKey?: unknown; url?: unknown }) {
  const storageKey = normalizeAssetStorageKey(kind, value.storageKey) || storageKeyFromAssetUrl(kind, value.url);
  return {
    ...(typeof value.assetId === 'string' && value.assetId.trim() ? { assetId: value.assetId.trim() } : {}),
    ...(storageKey ? { storageKey } : {}),
  };
}

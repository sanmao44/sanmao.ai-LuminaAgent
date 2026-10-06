export type ImageStorageItem = {
  url: string;
  [key: string]: unknown;
};

export type ImageStorageResult<T extends ImageStorageItem = ImageStorageItem> = {
  ok: boolean;
  images: T[];
};

function isImageStorageItem(value: unknown): value is ImageStorageItem {
  return Boolean(value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string');
}

/**
 * Store browser-visible image references through the existing storage route.
 * The caller keeps the product-specific fallback and presentation behavior.
 */
export async function storeImages<T extends ImageStorageItem>(
  images: readonly T[],
  options: { signal?: AbortSignal } = {},
): Promise<ImageStorageResult<T>> {
  if (!images.length) return { ok: true, images: [] };

  const response = await fetch('/api/storage/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const data: unknown = await response.json().catch(() => ({}));
  const records = data && typeof data === 'object' && Array.isArray((data as { images?: unknown }).images)
    ? (data as { images: unknown[] }).images.filter(isImageStorageItem)
    : [];

  return {
    ok: response.ok,
    images: records as T[],
  };
}

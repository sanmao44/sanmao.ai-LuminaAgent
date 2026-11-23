import { modelPreviewDownloadProgress, type ModelPreviewDownloadProgress } from './three-d-preview-progress';

type ProgressListener = (progress: ModelPreviewDownloadProgress) => void;
type PendingPreview = { listeners: Set<ProgressListener>; promise: Promise<ArrayBuffer> };

type ModelPreviewBytesCacheOptions = {
  fetchResponse?: typeof fetch;
  maxEntries?: number;
  maxBytes?: number;
};

const MAX_CACHED_PREVIEW_ENTRIES = 8;
const MAX_CACHED_PREVIEW_BYTES = 64 * 1024 * 1024;

export function createModelPreviewBytesCache(options: ModelPreviewBytesCacheOptions = {}) {
  const fetchResponse = options.fetchResponse || ((input, init) => fetch(input, init));
  const maxEntries = options.maxEntries ?? MAX_CACHED_PREVIEW_ENTRIES;
  const maxBytes = options.maxBytes ?? MAX_CACHED_PREVIEW_BYTES;
  const cache = new Map<string, ArrayBuffer>();
  const pending = new Map<string, PendingPreview>();
  let cachedBytes = 0;

  const notify = (listeners: Set<ProgressListener>, progress: ModelPreviewDownloadProgress) => {
    for (const listener of listeners) listener(progress);
  };

  const download = async (url: string, listeners: Set<ProgressListener>) => {
    const response = await fetchResponse(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok || !response.body) throw new Error(`模型预览请求失败：HTTP ${response.status}`);

    const rawLength = Number(response.headers.get('content-length'));
    const totalBytes = Number.isSafeInteger(rawLength) && rawLength > 0 ? rawLength : null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loadedBytes += value.byteLength;
      notify(listeners, modelPreviewDownloadProgress(loadedBytes, totalBytes ?? 0));
    }
    if (loadedBytes === 0) throw new Error('模型预览没有收到文件数据。');

    const bytes = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    notify(listeners, modelPreviewDownloadProgress(loadedBytes, totalBytes ?? loadedBytes));

    if (loadedBytes <= maxBytes) {
      cache.set(url, bytes.buffer);
      cachedBytes += loadedBytes;
      while (cache.size > maxEntries || cachedBytes > maxBytes) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cachedBytes -= cache.get(oldest)?.byteLength || 0;
        cache.delete(oldest);
      }
    }
    return bytes.buffer;
  };

  return {
    load(url: string, onProgress?: ProgressListener): Promise<ArrayBuffer> {
      const key = String(url || '');
      if (!key) return Promise.reject(new Error('模型预览地址为空。'));

      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        onProgress?.(modelPreviewDownloadProgress(cached.byteLength, cached.byteLength));
        return Promise.resolve(cached);
      }

      const existing = pending.get(key);
      if (existing) {
        if (onProgress) existing.listeners.add(onProgress);
        return existing.promise;
      }

      const listeners = new Set<ProgressListener>();
      if (onProgress) listeners.add(onProgress);
      const entry: PendingPreview = { listeners, promise: Promise.resolve(new ArrayBuffer(0)) };
      pending.set(key, entry);
      entry.promise = download(key, listeners).then(
        (bytes) => {
          pending.delete(key);
          return bytes;
        },
        (error: unknown) => {
          pending.delete(key);
          throw error;
        },
      );
      return entry.promise;
    },
  };
}

const modelPreviewBytesCache = createModelPreviewBytesCache();

export function loadModelPreviewBytes(url: string, onProgress?: ProgressListener) {
  return modelPreviewBytesCache.load(url, onProgress);
}

import { appendGenerationLog, finishGenerationLog } from './generation-log';
import { persistGeneratedImages, type ImageDownloadAuth } from './image-storage';
import type { GeneratedImage, ReferenceImageRecord } from './types';
import type { GenerationSource } from './generation-source';

type BackgroundGenerationLog = {
  mode: 'generate' | 'edit' | 'upscale' | 'agent';
  source?: GenerationSource;
  prompt: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  resolution?: string;
  aspectRatio?: string;
  outputSize?: string;
  count?: number;
  references?: ReferenceImageRecord[];
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
  taskId?: string;
};

type BackgroundPersistenceOptions = {
  images: GeneratedImage[];
  storagePath?: string;
  startedAt: number;
  providerFinishedAt: number;
  logId?: string;
  log?: BackgroundGenerationLog;
  downloadAuth?: ImageDownloadAuth;
};

/** Persist the local copy and finalize the log before returning the image response. */
export async function persistGenerationResult(options: BackgroundPersistenceOptions) {
  const storageStartedAt = Date.now();
  try {
    const stored = await persistGeneratedImages(options.images, options.storagePath, options.downloadAuth);
    const patch = {
      status: 'success' as const,
      durationMs: Date.now() - options.startedAt,
      providerDurationMs: options.providerFinishedAt - options.startedAt,
      storageDurationMs: Date.now() - storageStartedAt,
      imageCount: stored.images.length,
      imageUrls: stored.images.map((image) => image.url),
      storagePath: stored.path,
    };
    try {
      if (options.logId) await finishGenerationLog(options.logId, patch);
      else if (options.log) await appendGenerationLog({ ...options.log, ...patch });
    } catch { /* Logging failures should not mask a saved generation. */ }
    return stored;
  } catch (error) {
    const storageError = error instanceof Error ? error.message : '本地图片保存失败';
    const patch = {
      status: 'error' as const,
      durationMs: options.providerFinishedAt - options.startedAt,
      providerDurationMs: options.providerFinishedAt - options.startedAt,
      storageDurationMs: Date.now() - storageStartedAt,
      imageCount: options.images.length,
      imageUrls: [],
      storagePath: options.storagePath,
      storageError,
      error: storageError,
    };
    try {
      if (options.logId) await finishGenerationLog(options.logId, patch);
      else if (options.log) await appendGenerationLog({ ...options.log, ...patch });
    } catch { /* Logging failures should not mask the storage failure. */ }
    throw error instanceof Error ? error : new Error(storageError);
  }
}

/** Backward-compatible fire-and-forget helper for callers that do not need canonical URLs. */
export function persistGenerationResultInBackground(options: BackgroundPersistenceOptions) {
  void persistGenerationResult(options).catch(() => undefined);
}

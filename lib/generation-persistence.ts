import { appendGenerationLog, finishGenerationLog } from './generation-log';
import { persistGeneratedImages } from './image-storage';
import type { GeneratedImage, ReferenceImageRecord } from './types';

type BackgroundGenerationLog = {
  mode: 'generate' | 'edit' | 'upscale' | 'agent';
  source?: 'workspace' | 'agent';
  prompt: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  resolution?: string;
  aspectRatio?: string;
  outputSize?: string;
  count?: number;
  references?: ReferenceImageRecord[];
};

type BackgroundPersistenceOptions = {
  images: GeneratedImage[];
  storagePath?: string;
  startedAt: number;
  providerFinishedAt: number;
  logId?: string;
  log?: BackgroundGenerationLog;
};

/** Persist the local copy and finalize the log without delaying the image response. */
export async function persistGenerationResult(options: BackgroundPersistenceOptions) {
  const storageStartedAt = Date.now();
  try {
    const stored = await persistGeneratedImages(options.images, options.storagePath);
    const patch = {
      status: 'success' as const,
      durationMs: Date.now() - options.startedAt,
      providerDurationMs: options.providerFinishedAt - options.startedAt,
      storageDurationMs: Date.now() - storageStartedAt,
      imageCount: stored.images.length,
      imageUrls: stored.images.map((image) => image.url),
      storagePath: stored.path,
    };
    if (options.logId) await finishGenerationLog(options.logId, patch);
    else if (options.log) await appendGenerationLog({ ...options.log, ...patch });
    return { ...stored, storageError: undefined };
  } catch (error) {
    const storageError = error instanceof Error ? error.message : '本地图片保存失败';
    const patch = {
      status: 'success' as const,
      durationMs: options.providerFinishedAt - options.startedAt,
      providerDurationMs: options.providerFinishedAt - options.startedAt,
      storageDurationMs: Date.now() - storageStartedAt,
      imageCount: options.images.length,
      imageUrls: options.images.map((image) => image.url),
      storagePath: options.storagePath,
      storageError,
    };
    try {
      if (options.logId) await finishGenerationLog(options.logId, patch);
      else if (options.log) await appendGenerationLog({ ...options.log, ...patch });
    } catch { /* Logging failures should not mask the generation result. */ }
    return { images: options.images, path: options.storagePath, storageError };
  }
}

/** Backward-compatible fire-and-forget helper for callers that do not need canonical URLs. */
export function persistGenerationResultInBackground(options: BackgroundPersistenceOptions) {
  void persistGenerationResult(options);
}

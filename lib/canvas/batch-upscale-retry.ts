import type { GenerationLog } from '../generation-log';
import { generationLogKind, generationLogOutputUrls } from './activity-log';
import { isExplicitUpscaleRejection } from '../upscale-task-retry-policy';

export const CANVAS_UPSCALE_RETRY_BATCH_LIMIT = 8;
export const CANVAS_UPSCALE_RETRY_CONCURRENCY = 2;

export type CanvasUpscaleRetryFailure = {
  log: GenerationLog;
  message: string;
};

export type CanvasUpscaleRetryResult = {
  succeeded: GenerationLog[];
  failed: CanvasUpscaleRetryFailure[];
};

export function canvasUpscaleRetryTaskId(log: GenerationLog) {
  const taskId = String(log.taskId || '').trim();
  return taskId || null;
}

export function canRetryCanvasUpscaleLog(log: GenerationLog) {
  return log.status === 'error'
    && log.mode === 'upscale'
    && generationLogKind(log) === 'image'
    && log.retryDisposition === 'explicit_rejection'
    && isExplicitUpscaleRejection(log.errorCode)
    && !log.providerTaskId
    && generationLogOutputUrls(log).length === 0
    && Boolean(canvasUpscaleRetryTaskId(log));
}

export function retryableCanvasUpscaleLogs(
  logs: readonly GenerationLog[],
  excludedTaskIds?: ReadonlySet<string>,
) {
  const seenTaskIds = new Set<string>();
  const candidates: GenerationLog[] = [];
  for (const log of logs) {
    if (!canRetryCanvasUpscaleLog(log)) continue;
    const taskId = canvasUpscaleRetryTaskId(log);
    if (!taskId || seenTaskIds.has(taskId)) continue;
    if (excludedTaskIds?.has(taskId)) continue;
    seenTaskIds.add(taskId);
    candidates.push(log);
    if (candidates.length >= CANVAS_UPSCALE_RETRY_BATCH_LIMIT) break;
  }
  return candidates;
}

export async function retryCanvasUpscaleLogs(
  logs: readonly GenerationLog[],
  retry: (log: GenerationLog) => Promise<unknown>,
  onProgress?: (completed: number, total: number) => void,
): Promise<CanvasUpscaleRetryResult> {
  const candidates = retryableCanvasUpscaleLogs(logs);
  const succeeded: GenerationLog[] = [];
  const failed: CanvasUpscaleRetryFailure[] = [];
  let nextIndex = 0;
  let completed = 0;

  const runNext = async () => {
    while (nextIndex < candidates.length) {
      const log = candidates[nextIndex];
      nextIndex += 1;
      try {
        await retry(log);
        succeeded.push(log);
      } catch (error) {
        failed.push({ log, message: error instanceof Error ? error.message : '未知错误' });
      } finally {
        completed += 1;
        onProgress?.(completed, candidates.length);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(CANVAS_UPSCALE_RETRY_CONCURRENCY, candidates.length) },
    () => runNext(),
  ));

  return { succeeded, failed };
}

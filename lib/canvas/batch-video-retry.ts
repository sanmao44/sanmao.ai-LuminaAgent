import type { GenerationLog } from '../generation-log';
import { generationLogKind } from './activity-log';

export const CANVAS_VIDEO_RETRY_BATCH_LIMIT = 8;
export const CANVAS_VIDEO_RETRY_CONCURRENCY = 2;

export type CanvasVideoRetryFailure = {
  log: GenerationLog;
  message: string;
};

export type CanvasVideoRetryResult = {
  succeeded: GenerationLog[];
  failed: CanvasVideoRetryFailure[];
};

export function canvasVideoRetryTaskId(log: GenerationLog) {
  const taskId = String(log.taskId || log.id || '').trim();
  return taskId || null;
}

export function canRetryCanvasVideoLog(log: GenerationLog) {
  return log.status === 'error'
    && generationLogKind(log) === 'video'
    && log.errorCode !== 'provider_result_unconfirmed'
    && Boolean(canvasVideoRetryTaskId(log));
}

export function retryableCanvasVideoLogs(
  logs: readonly GenerationLog[],
  excludedTaskIds?: ReadonlySet<string>,
) {
  const seenTaskIds = new Set<string>();
  const candidates: GenerationLog[] = [];
  for (const log of logs) {
    if (!canRetryCanvasVideoLog(log)) continue;
    const taskId = canvasVideoRetryTaskId(log);
    if (!taskId) continue;
    if (excludedTaskIds?.has(taskId)) continue;
    if (seenTaskIds.has(taskId)) continue;
    seenTaskIds.add(taskId);
    candidates.push(log);
    if (candidates.length >= CANVAS_VIDEO_RETRY_BATCH_LIMIT) break;
  }
  return candidates;
}

export async function retryCanvasVideoLogs(
  logs: readonly GenerationLog[],
  retry: (log: GenerationLog) => Promise<unknown>,
  onProgress?: (completed: number, total: number) => void,
): Promise<CanvasVideoRetryResult> {
  const candidates = retryableCanvasVideoLogs(logs);
  const succeeded: GenerationLog[] = [];
  const failed: CanvasVideoRetryFailure[] = [];
  let nextIndex = 0;
  let completed = 0;

  const runNext = async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      const log = candidates[index];
      try {
        await retry(log);
        succeeded.push(log);
      } catch (error) {
        failed.push({
          log,
          message: error instanceof Error ? error.message : '未知错误',
        });
      } finally {
        completed += 1;
        onProgress?.(completed, candidates.length);
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CANVAS_VIDEO_RETRY_CONCURRENCY, candidates.length) },
      () => runNext(),
    ),
  );

  return { succeeded, failed };
}

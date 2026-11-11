type GenerationLogSnapshot = {
  status: 'pending' | 'success' | 'error';
  prompt?: string;
  imageUrls?: string[];
  error?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  errorCode?: string;
  aspectRatio?: string;
  outputSize?: string;
  source?: string;
  references?: unknown[];
};

export type AcceptedGenerationLogResult =
  | { taskId: string; status: 'pending' }
  | { taskId: string; status: 'missing' }
  | { taskId: string; status: 'unavailable' }
  | { taskId: string; status: 'error'; error?: string }
  | { taskId: string; status: 'success'; log: GenerationLogSnapshot; imageUrls: string[] };

export type AcceptedGenerationRecoveryProjection = {
  status: 'error' | 'success';
  providerPossiblyAccepted: boolean;
  unconfirmedTaskIds: string[];
  recoveredCount: number;
  phase: 'waiting' | 'retryable' | 'recovered';
  error?: string;
};

export type AcceptedGenerationTaskCandidate = {
  id?: unknown;
  status?: unknown;
  providerPossiblyAccepted?: unknown;
  checkingAcceptedGeneration?: unknown;
};

/** Return accepted tasks that are safe to inspect once in the background. */
export function acceptedGenerationTaskIdsForAutoCheck(
  tasks: readonly AcceptedGenerationTaskCandidate[],
  alreadyChecked: ReadonlySet<string> = new Set(),
) {
  const seen = new Set(alreadyChecked);
  return tasks.flatMap((task) => {
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    if (!id || task.status !== 'error' || task.providerPossiblyAccepted !== true
      || task.checkingAcceptedGeneration === true || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

export function isProviderAcceptanceResponse(status: number, body: unknown) {
  if (status === 202) return true;
  return typeof body === 'object' && body !== null && 'pending' in body && body.pending === true;
}

export async function inspectAcceptedGenerationLogs(
  taskIds: readonly string[],
  getLog: (taskId: string) => Promise<GenerationLogSnapshot | null>,
): Promise<AcceptedGenerationLogResult[]> {
  return Promise.all(taskIds.map(async (taskId): Promise<AcceptedGenerationLogResult> => {
    try {
      const log = await getLog(taskId);
      if (!log) return { taskId, status: 'missing' };
      const imageUrls = Array.isArray(log.imageUrls) ? log.imageUrls.filter((url) => typeof url === 'string' && Boolean(url.trim())) : [];
      if (log.status === 'success' && imageUrls.length) {
        return { taskId, status: 'success', log, imageUrls };
      }
      if (log.errorCode === 'provider_result_unconfirmed') return { taskId, status: 'pending' };
      if (log.status === 'error' || log.status === 'success') return { taskId, status: 'error', error: log.error };
      return { taskId, status: 'pending' };
    } catch {
      return { taskId, status: 'unavailable' };
    }
  }));
}

export function projectAcceptedGenerationRecovery(
  expectedCount: number,
  existingImageCount: number,
  results: readonly AcceptedGenerationLogResult[],
): AcceptedGenerationRecoveryProjection {
  const unresolvedTaskIds = results.flatMap((result) => result.status === 'pending' || result.status === 'unavailable' ? [result.taskId] : []);
  const confirmedErrors = results.flatMap((result) => result.status === 'error'
    ? [result.error || '原任务已结束，但没有保存可用图片。']
    : result.status === 'missing' ? ['服务端没有找到原任务记录，可以安全重试。'] : []);
  const recoveredCount = results.reduce((count, result) => count + (result.status === 'success' ? result.imageUrls.length : 0), 0);
  const incomplete = unresolvedTaskIds.length > 0 || confirmedErrors.length > 0 || existingImageCount + recoveredCount < Math.max(1, expectedCount);
  return {
    status: incomplete ? 'error' : 'success',
    providerPossiblyAccepted: unresolvedTaskIds.length > 0,
    unconfirmedTaskIds: unresolvedTaskIds,
    recoveredCount,
    phase: unresolvedTaskIds.length ? 'waiting' : incomplete ? 'retryable' : 'recovered',
    ...(unresolvedTaskIds.length
      ? { error: '服务端记录仍在等待确认；请稍后再次核对。系统没有重新提交任务。' }
      : confirmedErrors.length
        ? { error: confirmedErrors.join('；') }
        : existingImageCount + recoveredCount < Math.max(1, expectedCount)
          ? { error: `原任务已恢复 ${existingImageCount + recoveredCount}/${Math.max(1, expectedCount)} 张图片，可安全重试剩余项。` }
          : {}),
  };
}

export function isGenerateRetryBlocked(task: { providerPossiblyAccepted?: boolean }) {
  return task.providerPossiblyAccepted === true;
}

export function acceptedGenerationGalleryItemId(taskId: string, index: number) {
  const safeTaskId = taskId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return `recovered-generation-${safeTaskId}-${Math.max(0, Math.floor(index))}`;
}

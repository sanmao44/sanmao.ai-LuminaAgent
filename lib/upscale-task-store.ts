import { randomUUID } from 'node:crypto';
import type { GenerationSource } from './generation-source';
import type { UpscaleModelId, UpscaleOutputFormat, UpscaleProviderId } from './types';
import { createTaskRepository } from './repositories/task-repository';
import { canBatchRetryUpscaleTask, type UpscaleRetryDisposition } from './upscale-task-retry-policy';

export type UpscaleTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export type UpscaleTask = {
  id: string;
  providerTaskId?: string;
  provider: UpscaleProviderId;
  model: UpscaleModelId;
  scale: 1 | 2 | 3 | 4;
  outputFormat?: UpscaleOutputFormat;
  outputQuality?: number;
  sourceImageId: string;
  /** 原图引用，重试时要用它重新提交。 */
  reference?: string;
  /** 生成记录 id：取消、成功、失败都靠它给记录收尾。 */
  logId?: string;
  /** 发起这条任务时的提示词与来源，重试时沿用同一套记录描述。 */
  prompt?: string;
  source?: GenerationSource;
  status: UpscaleTaskStatus;
  localImageUrl?: string;
  /** Provider URL or inline fallback retained when local archiving fails. */
  remoteImageUrl?: string;
  storageError?: string;
  errorCode?: string;
  error?: string;
  retryDisposition?: UpscaleRetryDisposition;
  /** Internal lease that serializes batch retries of a failed task. */
  retryClaimedAt?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** 用户主动取消的时间；取消后不再轮询服务商。 */
  cancelledAt?: string;
  /** 由哪条任务重试而来。 */
  retryOf?: string;
  pollCount: number;
  nextPollAt?: number;
  idempotencyKey: string;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
};

// 高清任务里带原图引用，沿用原有 0600 权限，避免局域网其它账号读到路径。
const store = createTaskRepository<UpscaleTask>({ fileName: 'upscale-tasks.json', fileMode: 0o600 });
export const UPSCALE_TASK_TIMEOUT_MS = 20 * 60 * 1000;
export const UPSCALE_TASK_RETRY_CLAIM_TTL_MS = 15 * 60 * 1000;

export type UpscaleTaskRetryClaimResult =
  | { claimed: true; task: UpscaleTask; retryAttempt: number; claimedAt: number }
  | { claimed: false; reason: 'not_found' | 'not_retryable' | 'already_claimed' | 'retry_in_progress' };

export async function createUpscaleTask(input: Omit<UpscaleTask, 'id' | 'createdAt' | 'updatedAt' | 'pollCount'>) {
  const now = new Date().toISOString();
  return store.insert({ ...input, id: randomUUID(), createdAt: now, updatedAt: now, pollCount: 0 });
}

export async function findUpscaleTask(id: string) { return store.find(id); }
export async function claimFailedUpscaleTaskRetry(id: string, now = Date.now()): Promise<UpscaleTaskRetryClaimResult> {
  return store.mutate((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return { claimed: false, reason: 'not_found' };
    if (!canBatchRetryUpscaleTask(task)) return { claimed: false, reason: 'not_retryable' };
    if (Number.isFinite(task.retryClaimedAt) && now - Number(task.retryClaimedAt) < UPSCALE_TASK_RETRY_CLAIM_TTL_MS) {
      return { claimed: false, reason: 'already_claimed' };
    }

    const retries = tasks.filter((item) => item.retryOf === id);
    if (retries.some((item) => !canBatchRetryUpscaleTask(item))) {
      return { claimed: false, reason: 'retry_in_progress' };
    }

    task.retryClaimedAt = now;
    return { claimed: true, task, retryAttempt: retries.length + 1, claimedAt: now };
  });
}

export async function releaseFailedUpscaleTaskRetry(id: string, claimedAt: number) {
  return store.mutate((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.retryClaimedAt !== claimedAt) return false;
    delete task.retryClaimedAt;
    return true;
  });
}

export async function listUpscaleTasks(limit = 100) { return store.list(limit); }
export async function listRunnableUpscaleTasks(now = Date.now(), limit = 100) {
  return (await store.page({
    page: 1,
    pageSize: limit,
    maxPageSize: limit,
    matches: (task) => {
      if (task.status !== 'queued' && task.status !== 'processing') return false;
      const createdAt = Date.parse(task.createdAt);
      const timedOutWithoutProviderId = !task.providerTaskId
        && Number.isFinite(createdAt)
        && createdAt + UPSCALE_TASK_TIMEOUT_MS <= now;
      const due = timedOutWithoutProviderId
        || !Number.isFinite(task.nextPollAt)
        || Number(task.nextPollAt) <= now;
      return due && (Boolean(task.providerTaskId) || timedOutWithoutProviderId);
    },
    compare: (left, right) => {
      const dueAt = (task: UpscaleTask) => {
        const createdAt = Date.parse(task.createdAt);
        if (!task.providerTaskId && Number.isFinite(createdAt)) return createdAt + UPSCALE_TASK_TIMEOUT_MS;
        return Number.isFinite(task.nextPollAt) ? Number(task.nextPollAt) : createdAt;
      };
      const leftDueAt = dueAt(left);
      const rightDueAt = dueAt(right);
      const leftCreatedAt = Date.parse(left.createdAt);
      const rightCreatedAt = Date.parse(right.createdAt);
      return (Number.isFinite(leftDueAt) ? leftDueAt : 0) - (Number.isFinite(rightDueAt) ? rightDueAt : 0)
        || (Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0) - (Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0)
        || left.id.localeCompare(right.id);
    },
  })).tasks;
}

export async function updateUpscaleTask(id: string, patch: Partial<UpscaleTask>) {
  return store.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function removeUpscaleTask(id: string) { return store.remove(id); }

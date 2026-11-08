import { randomUUID } from 'node:crypto';
import type { VideoGenerationInput } from './types';
import type { GenerationSource } from './generation-source';
import { createTaskRepository } from './repositories/task-repository';

export type VideoTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type VideoTask = {
  id: string;
  providerId: string;
  providerTaskId?: string;
  videoId?: string;
  providerModel?: string;
  providerStatus?: string;
  providerProgress?: number;
  providerResponse?: unknown;
  modelId: string;
  modelName?: string;
  operation: 'generate' | 'edit' | 'extend';
  source?: GenerationSource;
  status: VideoTaskStatus;
  idempotencyKey: string;
  input: VideoGenerationInput;
  videoUrls: string[];
  remoteVideoUrls: string[];
  localVideoPaths: string[];
  costUsd?: number;
  errorCode?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** 用户主动取消的时间；取消后不再轮询服务商。 */
  cancelledAt?: string;
  /** 由哪条任务重试而来。 */
  retryOf?: string;
  /** Internal lease used to serialize batch retries of a failed task. */
  retryClaimedAt?: number;
  pollCount: number;
  nextPollAt?: number;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
};

const store = createTaskRepository<VideoTask>({ fileName: 'video-tasks.json' });

export const VIDEO_TASK_RETRY_CLAIM_TTL_MS = 15 * 60 * 1000;

export type VideoTaskRetryClaimResult =
  | { claimed: true; task: VideoTask; retryAttempt: number; claimedAt: number }
  | { claimed: false; reason: 'not_found' | 'not_retryable' | 'already_claimed' | 'retry_in_progress' };

function hasVideoTaskOutput(task: VideoTask) {
  return [task.videoUrls, task.remoteVideoUrls].some((urls) =>
    Array.isArray(urls) && urls.some((url) => String(url || '').trim().length > 0),
  );
}

export async function createVideoTask(input: Omit<VideoTask, 'id' | 'createdAt' | 'pollCount' | 'videoUrls' | 'remoteVideoUrls' | 'localVideoPaths'>) {
  return store.insert({
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    pollCount: 0,
    videoUrls: [],
    remoteVideoUrls: [],
    localVideoPaths: [],
  });
}

export async function findVideoTask(id: string) { return store.find(id); }
export async function claimFailedVideoTaskRetry(id: string, now = Date.now()): Promise<VideoTaskRetryClaimResult> {
  return store.mutate((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return { claimed: false, reason: 'not_found' };
    if ((task.status !== 'failed' && task.status !== 'cancelled') || hasVideoTaskOutput(task)) {
      return { claimed: false, reason: 'not_retryable' };
    }
    if (Number.isFinite(task.retryClaimedAt) && now - Number(task.retryClaimedAt) < VIDEO_TASK_RETRY_CLAIM_TTL_MS) {
      return { claimed: false, reason: 'already_claimed' };
    }

    const retries = tasks.filter((item) => item.retryOf === id);
    if (retries.some((item) => item.status === 'pending' || item.status === 'running' || item.status === 'done' || hasVideoTaskOutput(item))) {
      return { claimed: false, reason: 'retry_in_progress' };
    }

    task.retryClaimedAt = now;
    return { claimed: true, task, retryAttempt: retries.length + 1, claimedAt: now };
  });
}

export async function releaseFailedVideoTaskRetry(id: string, claimedAt: number) {
  return store.mutate((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.retryClaimedAt !== claimedAt) return false;
    delete task.retryClaimedAt;
    return true;
  });
}
export async function listVideoTasks(limit = 100) { return store.list(limit); }
export async function listRunnableVideoTasks(now = Date.now(), limit = 100) {
  return (await store.page({
    page: 1,
    pageSize: limit,
    maxPageSize: limit,
    matches: (task) => (task.status === 'pending' || task.status === 'running')
      && (!Number.isFinite(task.nextPollAt) || Number(task.nextPollAt) <= now),
    compare: (left, right) => {
      const leftCreatedAt = Date.parse(left.createdAt);
      const rightCreatedAt = Date.parse(right.createdAt);
      const leftPollAt = Number.isFinite(left.nextPollAt) ? Number(left.nextPollAt) : leftCreatedAt;
      const rightPollAt = Number.isFinite(right.nextPollAt) ? Number(right.nextPollAt) : rightCreatedAt;
      return (Number.isFinite(leftPollAt) ? leftPollAt : 0) - (Number.isFinite(rightPollAt) ? rightPollAt : 0)
        || (Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0) - (Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0)
        || left.id.localeCompare(right.id);
    },
  })).tasks;
}

export async function listVideoTasksPage(options: {
  page?: number;
  pageSize?: number;
  search?: string;
  source?: string;
  media?: string;
} = {}) {
  const search = String(options.search || '').trim().toLowerCase();
  const source = String(options.source || 'all');
  const media = String(options.media || 'video');
  return store.page({
    page: options.page,
    pageSize: options.pageSize,
    matches: (task) => {
      if (media !== 'all' && media !== 'video') return false;
      if (source !== 'all' && source !== task.source && !(source === 'workspace' && !task.source)) return false;
      if (!search) return true;
      return `${task.input?.prompt || ''} ${task.modelName || ''}`.toLowerCase().includes(search);
    },
  });
}

export async function findVideoTaskByIdempotencyKey(key: string) { return store.findByIdempotencyKey(key); }
export async function updateVideoTask(id: string, patch: Partial<VideoTask>) { return store.update(id, patch); }
export async function removeVideoTask(id: string) { return store.remove(id); }

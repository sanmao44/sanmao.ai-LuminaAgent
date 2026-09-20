import { randomUUID } from 'node:crypto';
import type { VideoGenerationInput } from './types';
import type { GenerationSource } from './generation-source';
import { createTaskStore } from './task-store';

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
  pollCount: number;
  nextPollAt?: number;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
};

const store = createTaskStore<VideoTask>({ fileName: 'video-tasks.json' });

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
export async function listVideoTasks(limit = 100) { return store.list(limit); }

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

export async function findVideoTaskByIdempotencyKey(key: string) { return store.findByKey(key); }
export async function updateVideoTask(id: string, patch: Partial<VideoTask>) { return store.update(id, patch); }
export async function removeVideoTask(id: string) { return store.remove(id); }

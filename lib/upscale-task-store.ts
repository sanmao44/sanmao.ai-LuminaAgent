import { randomUUID } from 'node:crypto';
import type { GenerationSource } from './generation-source';
import type { UpscaleModelId, UpscaleOutputFormat, UpscaleProviderId } from './types';
import { createTaskStore } from './task-store';

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
  errorCode?: string;
  error?: string;
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
const store = createTaskStore<UpscaleTask>({ fileName: 'upscale-tasks.json', fileMode: 0o600 });

export async function createUpscaleTask(input: Omit<UpscaleTask, 'id' | 'createdAt' | 'updatedAt' | 'pollCount'>) {
  const now = new Date().toISOString();
  return store.insert({ ...input, id: randomUUID(), createdAt: now, updatedAt: now, pollCount: 0 });
}

export async function findUpscaleTask(id: string) { return store.find(id); }
export async function listUpscaleTasks(limit = 100) { return store.list(limit); }

export async function updateUpscaleTask(id: string, patch: Partial<UpscaleTask>) {
  return store.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function removeUpscaleTask(id: string) { return store.remove(id); }

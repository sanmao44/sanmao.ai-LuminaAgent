/** Worker-owned task lifecycle controls. */
import { cancelVideoTask as cancelVideoTaskService, retryVideoTask as retryVideoTaskService, refreshVideoTask as refreshVideoTaskService } from '../../lib/video-task-service';
import { cancelUpscaleTask as cancelUpscaleTaskService, retryUpscaleTask as retryUpscaleTaskService, refreshUpscaleTask as refreshUpscaleTaskService } from '../../lib/upscale-service';
import { refreshVideoTask as refreshVideoTaskEntry } from './video-task';
import { refreshUpscaleTask as refreshUpscaleTaskEntry } from './task-entry';
import { cleanupCloneJobDirectory } from '../../lib/clone/pipeline';
import { findCloneJob, removeCloneJob, updateCloneJob } from '../../lib/clone/store';
import { cloneTaskRuntime } from '../../lib/clone/task-runtime';
import type { CloneJob } from '../../lib/clone/types';
import { moveMediaToTrash } from '../../lib/generation-log';
import { saveVideoTaskLocally as saveVideoTaskService } from '../../lib/video-task-service';
import { findVideoTask, updateVideoTask } from '../../lib/video-task-store';
import { findUpscaleTask, updateUpscaleTask } from '../../lib/upscale-task-store';
import { videoTaskRuntime } from '../../lib/video-task-runtime';
import { videoTaskOutputUrls, videoTaskStatus } from '../../lib/video-task-output';
import { upscaleTaskOutputUrl, upscaleTaskStatus } from '../../lib/upscale-task-output';
import { upscaleTaskRuntime } from '../../lib/upscale-task-runtime';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { runTaskLifecycle } from './task-lifecycle';

export class TaskControlConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskControlConflictError';
  }
}

export async function cancelVideoTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('video', id, () => cancelVideoTaskService(id), observer);
}
export async function retryVideoTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('video', id, () => retryVideoTaskService(id), observer);
}
export async function cancelUpscaleTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('upscale', id, () => cancelUpscaleTaskService(id), observer);
}
export async function retryUpscaleTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('upscale', id, () => retryUpscaleTaskService(id), observer);
}
export async function refreshVideoTask(id: string, observer?: RuntimeObserver) {
  return refreshVideoTaskEntry(id, async () => refreshVideoTaskService(id), observer || undefined);
}
export async function refreshUpscaleTask(id: string, observer?: RuntimeObserver) {
  return refreshUpscaleTaskEntry(id, async () => refreshUpscaleTaskService(id), observer || undefined);
}
export async function getVideoTask(id: string, observer?: RuntimeObserver) {
  const task = await findVideoTask(id);
  if (!task) return null;
  const projectedStatus = videoTaskStatus(task);
  if (projectedStatus === 'done' && projectedStatus !== task.status && videoTaskOutputUrls(task).length) {
    return updateVideoTask(id, {
      status: 'done',
      completedAt: task.completedAt || new Date().toISOString(),
      errorCode: undefined,
    });
  }
  return videoTaskRuntime.isActive(task.status) ? refreshVideoTask(id, observer) : task;
}
export async function getUpscaleTask(id: string, observer?: RuntimeObserver) {
  const task = await findUpscaleTask(id);
  if (!task) return null;
  const projectedStatus = upscaleTaskStatus(task);
  if (projectedStatus === 'succeeded' && projectedStatus !== task.status && upscaleTaskOutputUrl(task)) {
    return updateUpscaleTask(id, {
      status: 'succeeded',
      completedAt: task.completedAt || new Date().toISOString(),
      errorCode: undefined,
    });
  }
  return upscaleTaskRuntime.isActive(task.status) ? refreshUpscaleTask(id, observer) : task;
}
export async function getVideoTasks<T extends { id: string }>(tasks: readonly T[], observer?: RuntimeObserver) {
  return Promise.all(tasks.map(async (task) => {
    const current = await getVideoTask(task.id, observer);
    return current || task;
  }));
}

export async function removeVideoTask(id: string, observer?: RuntimeObserver) {
  const { removeVideoTask: remove } = await import('../../lib/video-task-store');
  return runTaskLifecycle('video', id, async () => {
    const current = await findVideoTask(id);
    if (!current) return null;
    if (videoTaskRuntime.isActive(current.status)) throw new TaskControlConflictError('视频正在生成，请先取消任务再删除。');
    const task = await remove(id);
    if (!task) return null;
    await Promise.all([...new Set(task.localVideoPaths || [])].map(async (file) => {
      try { await moveMediaToTrash(file, 'videos'); } catch { /* Missing media must not prevent task record removal. */ }
    }));
    return task;
  }, observer);
}

export async function removeUpscaleTask(id: string, observer?: RuntimeObserver) {
  const { removeUpscaleTask: remove } = await import('../../lib/upscale-task-store');
  return runTaskLifecycle('upscale', id, async () => {
    const current = await findUpscaleTask(id);
    if (!current) return null;
    if (upscaleTaskRuntime.isActive(current.status)) throw new TaskControlConflictError('超分任务正在处理中，先取消任务再删除。');
    return remove(id);
  }, observer);
}

export async function saveVideoTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('video', id, () => saveVideoTaskService(id), observer);
}

/** Worker-owned Clone cancellation. API routes only authorize and adapt the response. */
export function cloneCancellationPatch(job: CloneJob | null): Partial<CloneJob> | null {
  if (!job || !cloneTaskRuntime.canCancel(job.stage)) return null;
  return {
    cancelRequested: true,
    stage: 'cancelled',
    message: '\u5df2\u53d6\u6d88\uff08\u5df2\u7ecf\u63d0\u4ea4\u7ed9\u670d\u52a1\u5546\u7684\u751f\u6210\u8bf7\u6c42\u53ef\u80fd\u4ecd\u5728\u8ba1\u8d39\uff09',
    finishedAt: new Date().toISOString(),
  };
}

export async function cancelCloneTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('clone', id, async () => {
    const job = await findCloneJob(id);
    const patch = cloneCancellationPatch(job);
    return patch ? updateCloneJob(id, patch) : job;
  }, observer);
}

/** Worker-owned Clone removal. Cancellation is persisted before the record is removed. */
export async function removeCloneTask(id: string, observer?: RuntimeObserver) {
  return runTaskLifecycle('clone', id, async () => {
    const job = await findCloneJob(id);
    if (!job) return { removed: false, cancelled: false };
    const wasRunning = cloneTaskRuntime.isActive(job.stage);
    if (wasRunning) await updateCloneJob(id, { cancelRequested: true });
    const removed = await removeCloneJob(id);
    await cleanupCloneJobDirectory(id);
    return { removed: Boolean(removed), cancelled: wasRunning };
  }, observer);
}

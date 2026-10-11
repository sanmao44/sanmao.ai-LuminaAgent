import { TaskRuntime } from '@/packages/task-runtime/runtime';
import type { VideoTaskStatus } from './video-task-store';

export const VIDEO_TASK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Only a task accepted by the provider can become stale; submission retries stay active. */
export function isStaleVideoTask(task: { createdAt: string; providerTaskId?: string }, now = Date.now()) {
  const createdAt = Date.parse(task.createdAt);
  return Boolean(task.providerTaskId?.trim())
    && Number.isFinite(createdAt)
    && now - createdAt > VIDEO_TASK_STALE_AFTER_MS;
}

/** Compatibility adapter from video task statuses to the stable Task Runtime. */
export const videoTaskRuntime = new TaskRuntime<VideoTaskStatus>((status) => {
  if (status === 'done') return 'succeeded';
  return status;
});

/** Keep the legacy API's ability to retry completed video tasks. */
export function canRetryVideoTask(status: VideoTaskStatus) {
  return videoTaskRuntime.canRetry(status) || videoTaskRuntime.state(status) === 'succeeded';
}

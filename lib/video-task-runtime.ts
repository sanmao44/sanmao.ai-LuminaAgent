import { TaskRuntime } from '@/packages/task-runtime/runtime';
import type { VideoTaskStatus } from './video-task-store';

/** Compatibility adapter from video task statuses to the stable Task Runtime. */
export const videoTaskRuntime = new TaskRuntime<VideoTaskStatus>((status) => {
  if (status === 'done') return 'succeeded';
  return status;
});

/** Keep the legacy API's ability to retry completed video tasks. */
export function canRetryVideoTask(status: VideoTaskStatus) {
  return videoTaskRuntime.canRetry(status) || videoTaskRuntime.state(status) === 'succeeded';
}

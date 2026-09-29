import { TaskRuntime } from '@/packages/task-runtime/runtime';
import type { UpscaleTaskStatus } from './upscale-task-store';

/** Compatibility adapter from upscale task statuses to the stable Task Runtime. */
export const upscaleTaskRuntime = new TaskRuntime<UpscaleTaskStatus>((status) => {
  if (status === 'processing') return 'running';
  return status;
});

/** Keep the legacy API's ability to retry completed upscale tasks. */
export function canRetryUpscaleTask(status: UpscaleTaskStatus) {
  return upscaleTaskRuntime.canRetry(status) || upscaleTaskRuntime.state(status) === 'succeeded';
}

import { TaskRuntime } from '@/packages/task-runtime/runtime';
import type { UpscaleTaskStatus } from './upscale-task-store';

/** Compatibility adapter from upscale task statuses to the stable Task Runtime. */
export const upscaleTaskRuntime = new TaskRuntime<UpscaleTaskStatus>((status) => {
  if (status === 'processing') return 'running';
  return status;
});

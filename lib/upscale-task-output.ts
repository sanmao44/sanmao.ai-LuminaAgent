import type { UpscaleTask, UpscaleTaskStatus } from './upscale-task-store';

export type UpscaleTaskOutput = Pick<UpscaleTask, 'localImageUrl' | 'remoteImageUrl' | 'status'>;

/** Returns the first usable image URL retained by the task. */
export function upscaleTaskOutputUrl(task: UpscaleTaskOutput) {
  return [task.localImageUrl, task.remoteImageUrl]
    .map((url) => String(url || '').trim())
    .find(Boolean) || '';
}

/** A retained result wins over a stale failure written by an older path. */
export function upscaleTaskStatus(task: UpscaleTaskOutput): UpscaleTaskStatus {
  return upscaleTaskOutputUrl(task) ? 'succeeded' : task.status;
}

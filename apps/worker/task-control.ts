/** Worker-owned task lifecycle controls. */
import { cancelVideoTask as cancelVideoTaskService, retryVideoTask as retryVideoTaskService } from '../../lib/video-task-service';
import { cancelUpscaleTask as cancelUpscaleTaskService, retryUpscaleTask as retryUpscaleTaskService } from '../../lib/upscale-service';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { runTaskLifecycle } from './task-lifecycle';

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

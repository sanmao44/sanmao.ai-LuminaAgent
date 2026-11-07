import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '../../packages/contracts/observability';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { FileRuntimeObserver } from '../../packages/observability/runtime-sink';
import { resolveLocalDataDir } from '../../lib/data-paths';
import type { UpscaleTask } from '../../lib/upscale-task-store';
import path from 'node:path';
import { runTaskLifecycle } from './task-lifecycle';

export type UpscaleTaskRunner = (taskId: string) => Promise<UpscaleTask | null>;

function createTaskObserver() {
  return new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(16),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
}

async function defaultUpscaleTaskRunner(taskId: string): Promise<UpscaleTask | null> {
  const { refreshUpscaleTask } = await import('../../lib/upscale-service');
  return refreshUpscaleTask(taskId);
}

export async function runUpscaleTask(
  taskId: string,
  runner: UpscaleTaskRunner = defaultUpscaleTaskRunner,
  observer: RuntimeObserver = createTaskObserver(),
): Promise<UpscaleTask | null> {
  return runTaskLifecycle('upscale', taskId, () => runner(taskId), observer);
}

export async function refreshUpscaleTask(
  taskId: string,
  runner: UpscaleTaskRunner = defaultUpscaleTaskRunner,
  observer: RuntimeObserver = createTaskObserver(),
): Promise<UpscaleTask | null> {
  return runTaskLifecycle('upscale', taskId, () => runner(taskId), observer);
}

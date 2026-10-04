import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '../../packages/contracts/observability';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { FileRuntimeObserver } from '../../packages/observability/runtime-sink';
import { resolveLocalDataDir } from '../../lib/data-paths';
import path from 'node:path';
import type { VideoTask } from '../../lib/video-task-store';
import type { VideoGenerationInput } from '../../lib/types';
import type { GenerationSource } from '../../lib/generation-source';
import type { createVideoGeneration } from '../../lib/video-task-service';
import { runTaskLifecycle } from './task-lifecycle';

export type VideoTaskRunner = (taskId: string) => Promise<VideoTask | null>;
export type VideoGenerationOptions = { modelId?: string; input: VideoGenerationInput; idempotencyKey?: string; source?: GenerationSource };
export type VideoGenerationResult = Awaited<ReturnType<typeof createVideoGeneration>>;
export type VideoGenerationRunner = (options: VideoGenerationOptions) => Promise<VideoGenerationResult>;

function createTaskObserver() {
  return new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(16),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
}

async function defaultVideoTaskRunner(taskId: string): Promise<VideoTask | null> {
  const { refreshVideoTask } = await import('../../lib/video-task-service');
  return refreshVideoTask(taskId);
}

async function defaultVideoGenerationRunner(options: VideoGenerationOptions) {
  const { createVideoGeneration } = await import('../../lib/video-task-service');
  return createVideoGeneration(options);
}

export async function runVideoTask(taskId: string, runner: VideoTaskRunner = defaultVideoTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<VideoTask | null> {
  return runTaskLifecycle('video', taskId, () => runner(taskId), observer);
}

export async function refreshVideoTask(taskId: string, runner: VideoTaskRunner = defaultVideoTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<VideoTask | null> {
  return runTaskLifecycle('video', taskId, () => runner(taskId), observer);
}

export async function runVideoGeneration(options: VideoGenerationOptions, runner: VideoGenerationRunner = defaultVideoGenerationRunner, observer: RuntimeObserver = createTaskObserver()): Promise<VideoGenerationResult> {
  const operationId = `video-generation-${options.idempotencyKey || 'request'}`;
  return runTaskLifecycle('video', operationId, () => runner(options), observer);
}

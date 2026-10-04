import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '../../packages/contracts/observability';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { FileRuntimeObserver } from '../../packages/observability/runtime-sink';
import { resolveLocalDataDir } from '../../lib/data-paths';
import path from 'node:path';
import type { VideoTask } from '../../lib/video-task-store';
import type { UpscaleTask } from '../../lib/upscale-task-store';
import type { VideoGenerationInput } from '../../lib/types';
import type { GenerationSource } from '../../lib/generation-source';
import type { startCloudUpscale } from '../../lib/upscale-service';
import type { createVideoGeneration } from '../../lib/video-task-service';
import { runTaskLifecycle } from './task-lifecycle';

export type CloneTaskRunner = (jobId: string) => Promise<unknown>;
export type VideoTaskRunner = (taskId: string) => Promise<VideoTask | null>;
export type UpscaleTaskRunner = (taskId: string) => Promise<UpscaleTask | null>;
export type VideoGenerationOptions = { modelId?: string; input: VideoGenerationInput; idempotencyKey?: string; source?: GenerationSource };
export type UpscaleGenerationOptions = Parameters<typeof startCloudUpscale>[0];
export type VideoGenerationResult = Awaited<ReturnType<typeof createVideoGeneration>>;
export type UpscaleGenerationResult = Awaited<ReturnType<typeof startCloudUpscale>>;
export type VideoGenerationRunner = (options: VideoGenerationOptions) => Promise<VideoGenerationResult>;
export type UpscaleGenerationRunner = (options: UpscaleGenerationOptions) => Promise<UpscaleGenerationResult>;

function createTaskObserver() {
  return new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(16),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
}

async function defaultCloneTaskRunner(jobId: string) {
  const { analyzeCloneJob } = await import('../../lib/clone/pipeline');
  return analyzeCloneJob(jobId);
}

async function defaultCloneExecutionRunner(jobId: string) {
  const { runCloneJob } = await import('../../lib/clone/pipeline');
  return runCloneJob(jobId);
}

async function defaultVideoTaskRunner(taskId: string): Promise<VideoTask | null> {
  const { refreshVideoTask } = await import('../../lib/video-task-service');
  return refreshVideoTask(taskId);
}

async function defaultUpscaleTaskRunner(taskId: string): Promise<UpscaleTask | null> {
  const { refreshUpscaleTask } = await import('../../lib/upscale-service');
  return refreshUpscaleTask(taskId);
}

async function defaultVideoGenerationRunner(options: VideoGenerationOptions) {
  const { createVideoGeneration } = await import('../../lib/video-task-service');
  return createVideoGeneration(options);
}

async function defaultUpscaleGenerationRunner(options: UpscaleGenerationOptions) {
  const { startCloudUpscale } = await import('../../lib/upscale-service');
  return startCloudUpscale(options);
}

/** Worker boundary for long-running clone execution. */
export async function runCloneJob(jobId: string, runner: CloneTaskRunner = defaultCloneTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<void> {
  const operationId = `clone-task-${jobId}`;
  const startedAt = Date.now();
  void observer.emit({ operationId, kind: 'task', phase: 'started', at: startedAt, identity: 'clone' });
  try {
    await runner(jobId);
    void observer.emit({ operationId, kind: 'task', phase: 'completed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'completed', identity: 'clone' });
  } catch (error) {
    void observer.emit({ operationId, kind: 'task', phase: 'failed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'failed', identity: 'clone', errorClass: error instanceof Error ? error.name : 'UnknownError' });
    throw error;
  }
}

export function dispatchCloneJob(jobId: string): void {
  void runCloneJob(jobId).catch(() => undefined);
}

/** Worker entry for a confirmed or resumed clone execution. */
export function dispatchCloneExecutionJob(jobId: string): void {
  void runCloneJob(jobId, defaultCloneExecutionRunner).catch(() => undefined);
}

/**
 * Worker boundary for a single video task reconciliation/poll.
 *
 * The API may request a refresh and await the result, while the task
 * execution ownership remains in the Worker entry instead of the route.
 */
export async function runVideoTask(taskId: string, runner: VideoTaskRunner = defaultVideoTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<VideoTask | null> {
  return runTaskBoundary(taskId, 'video', runner, observer);
}

/** Worker boundary for a single upscale task reconciliation/poll. */
export async function runUpscaleTask(taskId: string, runner: UpscaleTaskRunner = defaultUpscaleTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<UpscaleTask | null> {
  return runTaskBoundary(taskId, 'upscale', runner, observer);
}

async function runTaskBoundary<T>(taskId: string, identity: 'video' | 'upscale', runner: (taskId: string) => Promise<T>, observer: RuntimeObserver): Promise<T> {
  return runTaskLifecycle(identity, taskId, async () => runner(taskId), observer);
}
export function dispatchVideoTask(taskId: string): void {
  void runVideoTask(taskId).catch(() => undefined);
}

export function dispatchUpscaleTask(taskId: string): void {
  void runUpscaleTask(taskId).catch(() => undefined);
}

/** Worker boundary for provider video submission and task creation. */
export async function runVideoGeneration(options: VideoGenerationOptions, runner: VideoGenerationRunner = defaultVideoGenerationRunner, observer: RuntimeObserver = createTaskObserver()): Promise<VideoGenerationResult> {
  const operationId = `video-generation-${options.idempotencyKey || 'request'}`;
  return runTaskBoundary(operationId, 'video', () => runner(options), observer);
}

/** Worker boundary for cloud upscale submission and task creation. */
export async function runUpscaleGeneration(options: UpscaleGenerationOptions, runner: UpscaleGenerationRunner = defaultUpscaleGenerationRunner, observer: RuntimeObserver = createTaskObserver()): Promise<UpscaleGenerationResult> {
  const operationId = `upscale-generation-${options.idempotencyKey || options.sourceImageId || 'request'}`;
  return runTaskBoundary(operationId, 'upscale', () => runner(options), observer);
}

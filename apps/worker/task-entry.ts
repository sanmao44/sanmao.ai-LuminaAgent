import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '../../packages/contracts/observability';
import type { RuntimeObserver } from '../../packages/contracts/observability';
import { FileRuntimeObserver } from '../../packages/observability/runtime-sink';
import { resolveLocalDataDir } from '../../lib/data-paths';
import path from 'node:path';
import type { UpscaleTask } from '../../lib/upscale-task-store';
import type { startCloudUpscale } from '../../lib/upscale-service';
import { runTaskLifecycle } from './task-lifecycle';
export { runVideoTask, refreshVideoTask, runVideoGeneration } from './video-task';
export type { VideoTaskRunner, VideoGenerationOptions, VideoGenerationResult, VideoGenerationRunner } from './video-task';

export type CloneTaskRunner = (jobId: string) => Promise<unknown>;
export type UpscaleTaskRunner = (taskId: string) => Promise<UpscaleTask | null>;
export type CloneReaper = () => Promise<number>;
export type UpscaleGenerationOptions = Parameters<typeof startCloudUpscale>[0];
export type UpscaleGenerationResult = Awaited<ReturnType<typeof startCloudUpscale>>;
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

async function defaultUpscaleTaskRunner(taskId: string): Promise<UpscaleTask | null> {
  const { refreshUpscaleTask: refresh } = await import('../../lib/upscale-service');
  return refresh(taskId);
}

async function defaultCloneReaper() {
  const { reapStaleCloneJobs } = await import('../../lib/clone/pipeline');
  return reapStaleCloneJobs();
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

/** Worker boundary for a single upscale task reconciliation/poll. */
export async function runUpscaleTask(taskId: string, runner: UpscaleTaskRunner = defaultUpscaleTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<UpscaleTask | null> {
  return runTaskBoundary(taskId, 'upscale', runner, observer);
}

/** Worker-owned reconciliation used by control and long-running execution. */
export async function refreshUpscaleTask(taskId: string, runner: UpscaleTaskRunner = defaultUpscaleTaskRunner, observer: RuntimeObserver = createTaskObserver()): Promise<UpscaleTask | null> {
  return runTaskBoundary(taskId, 'upscale', runner, observer);
}

async function runTaskBoundary<T>(taskId: string, identity: 'video' | 'upscale', runner: (taskId: string) => Promise<T>, observer: RuntimeObserver): Promise<T> {
  return runTaskLifecycle(identity, taskId, async () => runner(taskId), observer);
}
/** Worker entry for stale Clone reconciliation; API listing remains read-only. */
export async function reapCloneTasks(reaper: CloneReaper = defaultCloneReaper, observer: RuntimeObserver = createTaskObserver()) {
  return runTaskLifecycle('clone', 'stale-reaper', reaper, observer);
}

/** Worker boundary for cloud upscale submission and task creation. */
export async function runUpscaleGeneration(options: UpscaleGenerationOptions, runner: UpscaleGenerationRunner = defaultUpscaleGenerationRunner, observer: RuntimeObserver = createTaskObserver()): Promise<UpscaleGenerationResult> {
  const operationId = `upscale-generation-${options.idempotencyKey || options.sourceImageId || 'request'}`;
  return runTaskBoundary(operationId, 'upscale', () => runner(options), observer);
}

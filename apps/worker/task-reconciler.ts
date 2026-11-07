import { refreshVideoTask } from './video-task';
import { refreshUpscaleTask } from './upscale-task';
import { listRunnableUpscaleTasks } from '../../lib/upscale-task-store';
import { listRunnableVideoTasks } from '../../lib/video-task-store';

const RECONCILE_INTERVAL_MS = 5_000;
const MAX_CONCURRENT_TASKS = 2;
const MAX_TASKS_PER_PASS = 12;

type ReconciliationTask = { kind: 'video' | 'upscale'; id: string };

export type TaskReconcilerDependencies = {
  listRunnableVideoTasks(now: number, limit: number): Promise<readonly { id: string }[]>;
  listRunnableUpscaleTasks(now: number, limit: number): Promise<readonly { id: string }[]>;
  refreshVideoTask(id: string): Promise<unknown>;
  refreshUpscaleTask(id: string): Promise<unknown>;
  onTaskError?(task: ReconciliationTask, error: unknown): void;
};

export type TaskReconciliationResult = {
  considered: number;
  refreshed: number;
  failed: number;
};

export async function reconcileDueTasks(
  dependencies: TaskReconcilerDependencies,
  options: { now?: number; concurrency?: number; maxTasks?: number } = {},
): Promise<TaskReconciliationResult> {
  const now = options.now ?? Date.now();
  const maxTasks = Math.max(1, Math.floor(options.maxTasks ?? MAX_TASKS_PER_PASS));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? MAX_CONCURRENT_TASKS));
  const [videos, upscales] = await Promise.all([
    dependencies.listRunnableVideoTasks(now, maxTasks),
    dependencies.listRunnableUpscaleTasks(now, maxTasks),
  ]);
  const tasks: ReconciliationTask[] = [];
  for (let index = 0; tasks.length < maxTasks && (index < videos.length || index < upscales.length); index += 1) {
    if (index < videos.length && tasks.length < maxTasks) tasks.push({ kind: 'video', id: videos[index].id });
    if (index < upscales.length && tasks.length < maxTasks) tasks.push({ kind: 'upscale', id: upscales[index].id });
  }

  let nextTask = 0;
  let refreshed = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextTask < tasks.length) {
      const task = tasks[nextTask++];
      try {
        if (task.kind === 'video') await dependencies.refreshVideoTask(task.id);
        else await dependencies.refreshUpscaleTask(task.id);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        dependencies.onTaskError?.(task, error);
      }
    }
  }));
  return { considered: tasks.length, refreshed, failed };
}

export function createTaskReconciler(
  dependencies: TaskReconcilerDependencies,
  options: { intervalMs?: number; concurrency?: number; maxTasks?: number } = {},
) {
  const intervalMs = Math.max(250, Math.floor(options.intervalMs ?? RECONCILE_INTERVAL_MS));
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const schedule = () => {
    if (!started || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      runCycle();
    }, intervalMs);
    timer.unref?.();
  };

  const runCycle = () => {
    if (inFlight) return inFlight;
    inFlight = reconcileDueTasks(dependencies, options)
      .then(() => undefined)
      .catch((error) => {
        console.error('[task-reconciler] cycle failed', error instanceof Error ? error.name : 'UnknownError');
      })
      .finally(() => {
        inFlight = undefined;
        schedule();
      });
    return inFlight;
  };

  return {
    start() {
      if (started) return;
      started = true;
      void runCycle();
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    reconcileOnce() {
      return reconcileDueTasks(dependencies, options);
    },
  };
}

const globalState = globalThis as typeof globalThis & {
  __SANMAO_TASK_RECONCILER__?: ReturnType<typeof createTaskReconciler>;
};

export function startTaskReconciler() {
  if (globalState.__SANMAO_TASK_RECONCILER__) return;
  const reconciler = createTaskReconciler({
    listRunnableVideoTasks,
    listRunnableUpscaleTasks,
    refreshVideoTask,
    refreshUpscaleTask,
    onTaskError(task, error) {
      console.error(`[task-reconciler] ${task.kind} task refresh failed`, task.id, error instanceof Error ? error.name : 'UnknownError');
    },
  });
  globalState.__SANMAO_TASK_RECONCILER__ = reconciler;
  reconciler.start();
}

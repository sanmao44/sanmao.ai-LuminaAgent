import type { CangyuanMediaTask } from '../packages/contracts/cangyuan-media';

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'running', 'waiting']);

export const CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS = 5_000;
export const CANGYUAN_3D_TASK_POLL_INTERVAL_MS = 3_000;

export function cangyuanMediaTaskPollIntervalMs(kind: CangyuanMediaTask['kind']) {
  return kind === '3d' ? CANGYUAN_3D_TASK_POLL_INTERVAL_MS : CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS;
}

export function nextCangyuanTaskPollBatch<T extends Pick<CangyuanMediaTask, 'id' | 'status'>>(
  tasks: T[],
  lastTaskId: string | null,
  limit = 4,
) {
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  if (!active.length) return { tasks: [], lastTaskId: null };

  const batchSize = Math.min(active.length, Math.max(1, Math.floor(limit) || 1));
  const previousIndex = active.findIndex((task) => task.id === lastTaskId);
  const start = previousIndex < 0 ? 0 : (previousIndex + 1) % active.length;
  const batch = Array.from({ length: batchSize }, (_, index) => active[(start + index) % active.length]);
  return { tasks: batch, lastTaskId: batch[batch.length - 1].id };
}

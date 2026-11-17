import { createTaskRepository } from './repositories/task-repository';
import type { CangyuanMediaTask } from '../packages/contracts/cangyuan-media';

const store = createTaskRepository<CangyuanMediaTask>({ fileName: 'cangyuan-creative-tasks.json', fileMode: 0o600 });

export const cangyuanCreativeTaskRepository = store;

export async function insertCangyuanCreativeTask(task: CangyuanMediaTask) {
  return store.insert(task);
}

export async function findCangyuanCreativeTask(id: string) {
  return store.find(id);
}

export async function findCangyuanCreativeTaskByKey(key: string) {
  return store.findByIdempotencyKey(key);
}

export async function listCangyuanCreativeTasks(limit = 100) {
  return store.list(limit);
}

export async function updateActiveCangyuanCreativeTask(id: string, patch: Partial<CangyuanMediaTask>) {
  return store.mutate((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') return null;
    Object.assign(task, patch, { id });
    return task;
  });
}

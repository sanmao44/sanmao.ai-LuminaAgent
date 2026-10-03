import { createTaskStore, type TaskRecord } from '../task-store';
import type { TaskRepository } from './types';

export type TaskRepositoryOptions = {
  fileName: string;
  fileMode?: number;
  maxList?: number;
};

/**
 * TEMPORARY MIGRATION ADAPTER: durable task records currently live in a JSON
 * file under the local data directory. The path and file format stay inside
 * the adapter so Task Runtime can later change persistence without changing
 * task services.
 */
export function createTaskRepository<TTask extends TaskRecord>(options: TaskRepositoryOptions): TaskRepository<TTask> {
  const store = createTaskStore<TTask>(options);
  return {
    mutate: store.mutate,
    find: store.find,
    findByIdempotencyKey: store.findByKey,
    list: store.list,
    page: store.page,
    insert: store.insert,
    update: store.update,
    remove: store.remove,
  };
}

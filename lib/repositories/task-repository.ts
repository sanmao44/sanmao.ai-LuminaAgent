import { createTaskStore, type TaskRecord } from '../task-store';
import type { TaskRepository } from './types';
import { deleteSqliteRecord, isSqliteActive, listSqliteRecords, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';

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
  if (isSqliteActive()) return createSqliteTaskRepository<TTask>(options);
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

function createSqliteTaskRepository<TTask extends TaskRecord>(options: TaskRepositoryOptions): TaskRepository<TTask> {
  const domain = `task:${options.fileName}`;
  let mutationChain: Promise<unknown> = Promise.resolve();
  const readAll = async () => listSqliteRecords<TTask>(domain).map((entry) => entry.value);
  const writeAll = (tasks: TTask[]) => {
    const current = new Set(listSqliteRecords<TTask>(domain).map((entry) => entry.key));
    for (const task of tasks) {
      writeSqliteRecord(domain, task.id, task);
      current.delete(task.id);
    }
    for (const id of current) deleteSqliteRecord(domain, id);
  };
  const mutate = <R>(fn: (tasks: TTask[]) => R | Promise<R>) => {
    const operation = mutationChain.then(async () => {
      const tasks = await readAll();
      const result = await fn(tasks);
      writeAll(tasks);
      return result;
    });
    mutationChain = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const maxList = Math.max(1, options.maxList ?? 500);
  return {
    mutate,
    async find(id) { return readSqliteRecord<TTask>(domain, id); },
    async findByIdempotencyKey(key) { return (await readAll()).find((task) => task.idempotencyKey === key) || null; },
    async list(limit = 100) { return (await readAll()).slice(0, Math.min(maxList, Math.max(1, limit))); },
    async page(pageOptions = {}) {
      const maxPageSize = Math.max(1, pageOptions.maxPageSize ?? 100);
      const pageSize = Math.min(maxPageSize, Math.max(1, Math.round(Number(pageOptions.pageSize) || pageOptions.defaultPageSize || 12)));
      const all = await readAll();
      const filtered = pageOptions.matches ? all.filter(pageOptions.matches) : all;
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(Math.max(1, Math.round(Number(pageOptions.page) || 1)), totalPages);
      return { tasks: filtered.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
    },
    async insert(task) {
      return mutate((tasks) => {
        const existing = task.idempotencyKey ? tasks.find((item) => item.idempotencyKey === task.idempotencyKey) : undefined;
        if (existing) return { task: existing, created: false };
        tasks.unshift(task);
        return { task, created: true };
      });
    },
    async update(id, patch) { return mutate((tasks) => { const index = tasks.findIndex((task) => task.id === id); if (index < 0) return null; tasks[index] = { ...tasks[index], ...patch, id }; return tasks[index]; }); },
    async remove(id) { return mutate((tasks) => { const index = tasks.findIndex((task) => task.id === id); if (index < 0) return null; const [removed] = tasks.splice(index, 1); return removed; }); },
  };
}

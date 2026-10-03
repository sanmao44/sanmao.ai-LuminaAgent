import { createTaskStore, type TaskRecord } from '../task-store';
import type { TaskRepository } from './types';
import { assertSqliteAuthority, isSqliteActive, listSqliteRecords, readSqliteRecord, sqliteAuthorityId, withSqliteTransaction } from '../database/sqlite';
import type { DatabaseSync } from 'node:sqlite';

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
  const assertStoreUnchanged = () => {
    if (isSqliteActive()) throw new Error('Database cutover activated SQLite; restart the application before using this repository instance');
  };
  return {
    mutate: async (fn) => { assertStoreUnchanged(); return store.mutate(fn); },
    find: async (id) => { assertStoreUnchanged(); return store.find(id); },
    findByIdempotencyKey: async (key) => { assertStoreUnchanged(); return store.findByKey(key); },
    list: async (limit) => { assertStoreUnchanged(); return store.list(limit); },
    page: async (options) => { assertStoreUnchanged(); return store.page(options); },
    insert: async (task) => { assertStoreUnchanged(); return store.insert(task); },
    update: async (id, patch) => { assertStoreUnchanged(); return store.update(id, patch); },
    remove: async (id) => { assertStoreUnchanged(); return store.remove(id); },
  };
}

function createSqliteTaskRepository<TTask extends TaskRecord>(options: TaskRepositoryOptions): TaskRepository<TTask> {
  const domain = `task:${options.fileName}`;
  const authorityId = sqliteAuthorityId();
  if (!authorityId) throw new Error('SQLite database is not active');
  const assertAuthority = () => assertSqliteAuthority(authorityId);
  let mutationChain: Promise<unknown> = Promise.resolve();
  const readAll = async () => listSqliteRecords<TTask>(domain).map((entry) => entry.value);
  const readAllFromDatabase = (db: DatabaseSync) => (db.prepare('SELECT record_key as key, value FROM sanmao_records WHERE domain = ? ORDER BY sort_order DESC').all(domain) as Array<{ key: string; value: string }>).map((row) => JSON.parse(row.value) as TTask);
  const writeAll = (db: DatabaseSync, tasks: TTask[]) => {
    const current = new Set((db.prepare('SELECT record_key as key FROM sanmao_records WHERE domain = ?').all(domain) as Array<{ key: string }>).map((entry) => entry.key));
    const insert = db.prepare(`INSERT INTO sanmao_records(domain, record_key, value, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain, record_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, sort_order = excluded.sort_order`);
    for (const task of tasks) {
      insert.run(domain, task.id, JSON.stringify(task), new Date().toISOString(), tasks.length - tasks.indexOf(task));
      current.delete(task.id);
    }
    for (const id of current) db.prepare('DELETE FROM sanmao_records WHERE domain = ? AND record_key = ?').run(domain, id);
  };
  const mutate = <R>(fn: (tasks: TTask[]) => R | Promise<R>) => {
    const operation = mutationChain.then(async () => {
      assertAuthority();
      return withSqliteTransaction(async (db) => {
        const tasks = readAllFromDatabase(db);
        const result = await fn(tasks);
        writeAll(db, tasks);
        return result;
      });
    });
    mutationChain = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const maxList = Math.max(1, options.maxList ?? 500);
  return {
    mutate,
    async find(id) { assertAuthority(); return readSqliteRecord<TTask>(domain, id); },
    async findByIdempotencyKey(key) { assertAuthority(); return (await readAll()).find((task) => task.idempotencyKey === key) || null; },
    async list(limit = 100) { assertAuthority(); return (await readAll()).slice(0, Math.min(maxList, Math.max(1, limit))); },
    async page(pageOptions = {}) {
      assertAuthority();
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

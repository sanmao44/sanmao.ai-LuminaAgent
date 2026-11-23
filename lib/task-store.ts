/**
 * 长任务存储基座。
 *
 * 视频任务和高清任务的存储层原先各自复制了一份「读 JSON → 改 → 原子写回」的实现，
 * 其中串行化写入和「临时文件 + rename」是最容易写错的部分。这里抽成一份共用：
 * 磁盘格式（顶层数组、缩进 2、结尾换行、临时文件原子替换）与并发写入语义都保持原样。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from './data-paths';

export type TaskRecord = { id: string; createdAt: string; idempotencyKey?: string };

export type TaskPageOptions<T> = {
  page?: number;
  pageSize?: number;
  /** 调用方未提供 pageSize 时的默认值。 */
  defaultPageSize?: number;
  maxPageSize?: number;
  /** 领域过滤（按来源、关键词等），分页计算由存储层统一负责。 */
  matches?: (task: T) => boolean;
  /** 匹配后、分页前的稳定排序。 */
  compare?: (left: T, right: T) => number;
};

export type TaskPage<T> = { tasks: T[]; total: number; page: number; pageSize: number; totalPages: number };

const DATA_DIR = resolveLocalDataDir();
const TASK_STORE_LOCK_TIMEOUT_MS = 30_000;

function taskStoreLockOwnerAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM and other uncertain errors cannot prove that an owner exited.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function removeTaskStoreLockDirectory(lockDir: string, ownerName?: string) {
  if (ownerName) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await unlink(path.join(lockDir, ownerName));
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code || '';
        if (code === 'ENOENT') break;
        const delay = RENAME_RETRY_DELAYS_MS[attempt];
        if (!TRANSIENT_RENAME_CODES.has(code) || delay === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  // Never recursively remove a shared lock path: another process may already
  // have published its unique owner file, which must keep rmdir from succeeding.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rmdir(lockDir);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || '';
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code)) return;
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!TRANSIENT_RENAME_CODES.has(code) || delay === undefined) throw error;
      const owners = await readdir(lockDir).catch((readError: NodeJS.ErrnoException) => {
        if (readError.code === 'ENOENT') return null;
        if (TRANSIENT_RENAME_CODES.has(readError.code || '')) return [];
        throw readError;
      });
      if (owners === null || owners.length) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function clearAbandonedTaskStoreLock(lockDir: string) {
  const owners = await readdir(lockDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || TRANSIENT_RENAME_CODES.has(error.code || '')) return [];
    throw error;
  });
  for (const ownerName of owners) {
    const owner = ownerName.match(/^(\d+)-[0-9a-f-]{36}\.owner$/iu);
    if (owner && !taskStoreLockOwnerAlive(Number(owner[1]))) {
      await removeTaskStoreLockDirectory(lockDir, ownerName);
    }
  }
  await removeTaskStoreLockDirectory(lockDir);
}

async function acquireTaskStoreLock(taskPath: string) {
  const lockDir = `${taskPath}.lock`;
  const parentDir = path.dirname(lockDir);
  const lockName = path.basename(lockDir);
  await mkdir(parentDir, { recursive: true });
  for (const entry of await readdir(parentDir)) {
    if (!entry.startsWith(`${lockName}.`) || !entry.endsWith('.pending')) continue;
    const candidate = entry.slice(lockName.length + 1, -'.pending'.length).match(/^(\d+)\.([0-9a-f-]{36})$/iu);
    if (candidate && !taskStoreLockOwnerAlive(Number(candidate[1]))) {
      await removeTaskStoreLockDirectory(path.join(parentDir, entry), `${candidate[1]}-${candidate[2]}.owner`);
    }
  }

  const token = randomUUID();
  const ownerName = `${process.pid}-${token}.owner`;
  const candidateDir = `${lockDir}.${process.pid}.${token}.pending`;
  await mkdir(candidateDir);
  let published = false;
  try {
    await writeFile(path.join(candidateDir, ownerName), '', { flag: 'wx', mode: 0o600 });
    const deadline = Date.now() + TASK_STORE_LOCK_TIMEOUT_MS;
    while (true) {
      try {
        // Publish an already nonempty directory atomically. An active lock is
        // never briefly empty while its owner is still registering itself.
        await rename(candidateDir, lockDir);
        published = true;
        return () => removeTaskStoreLockDirectory(lockDir, ownerName);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        await clearAbandonedTaskStoreLock(lockDir);
        if (Date.now() >= deadline) throw new Error('本地任务存储正被其他进程使用，请稍后重试。');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  } finally {
    if (!published) await removeTaskStoreLockDirectory(candidateDir, ownerName);
  }
}

/**
 * 临时文件改名覆盖目标时，Windows 上防病毒 / 索引器会短暂占用刚写完的文件，
 * rename 偶发 EPERM / EBUSY / EACCES；这类占用是瞬时的，退避重试几次就过。
 * 不重试的代价很具体：一次瞬时占用等于丢掉这次状态更新——克隆出片里就表现为
 * 「镜头退回静态图」或任务永远停在旧阶段，用户完全不知道发生了什么。
 */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EEXIST']);
const RENAME_RETRY_DELAYS_MS = [20, 60, 150, 400];

export async function renameWithRetry(
  from: string,
  to: string,
  renameFile: (source: string, target: string) => Promise<void> = rename,
  delays: readonly number[] = RENAME_RETRY_DELAYS_MS,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(from, to);
      return;
    } catch (error) {
      const code = String((error as NodeJS.ErrnoException).code || '');
      const delay = delays[attempt];
      if (delay === undefined || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function createTaskStore<T extends TaskRecord>(options: { fileName: string; fileMode?: number; maxList?: number }) {
  const taskPath = path.join(DATA_DIR, options.fileName);
  const maxList = Math.max(1, options.maxList ?? 500);
  // Instance-local queuing avoids unnecessary lock contention; the filesystem
  // lock below also serializes independently loaded bundles and processes.
  let mutationChain: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<T[]> {
    try {
      const value = JSON.parse(await readFile(taskPath, 'utf8'));
      return Array.isArray(value) ? value as T[] : [];
    } catch { return []; }
  }

  async function writeAll(tasks: T[]) {
    await mkdir(DATA_DIR, { recursive: true });
    const temporary = `${taskPath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(tasks, null, 2)}\n`;
    await writeFile(temporary, payload, options.fileMode ? { encoding: 'utf8', mode: options.fileMode } : 'utf8');
    try {
      await renameWithRetry(temporary, taskPath);
    } catch (error) {
      // 写不进去也不能把数据目录留成垃圾场：临时文件已经没有价值，删掉再把真实错误抛上去。
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async function mutate<R>(fn: (tasks: T[]) => R | Promise<R>): Promise<R> {
    const operation = mutationChain.then(async () => {
      const releaseLock = await acquireTaskStoreLock(taskPath);
      try {
        const tasks = await readAll();
        const result = await fn(tasks);
        await writeAll(tasks);
        return result;
      } finally {
        await releaseLock();
      }
    });
    mutationChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    /** 只读全部记录；返回的是磁盘快照，改动它不会落盘。 */
    readAll,
    /** 需要读—改—写多步时用它，回调内直接改数组即可，写完自动落盘。 */
    mutate,
    async find(id: string) { return (await readAll()).find((task) => task.id === id) || null; },
    async findByKey(key: string) { return (await readAll()).find((task) => task.idempotencyKey === key) || null; },
    async list(limit = 100) { return (await readAll()).slice(0, Math.min(maxList, Math.max(1, limit))); },
    async page(pageOptions: TaskPageOptions<T> = {}): Promise<TaskPage<T>> {
      const maxPageSize = Math.max(1, pageOptions.maxPageSize ?? 100);
      const pageSize = Math.min(maxPageSize, Math.max(1, Math.round(Number(pageOptions.pageSize) || pageOptions.defaultPageSize || 12)));
      const tasks = await readAll();
      const matched = pageOptions.matches ? tasks.filter(pageOptions.matches) : tasks;
      const filtered = pageOptions.compare ? [...matched].sort(pageOptions.compare) : matched;
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(Math.max(1, Math.round(Number(pageOptions.page) || 1)), totalPages);
      const start = (page - 1) * pageSize;
      return { tasks: filtered.slice(start, start + pageSize), total, page, pageSize, totalPages };
    },
    /** 带幂等键的任务只会写入一次，重复提交返回已存在的记录。 */
    async insert(task: T) {
      return mutate((tasks) => {
        const existing = task.idempotencyKey ? tasks.find((item) => item.idempotencyKey === task.idempotencyKey) : undefined;
        if (existing) return { task: existing, created: false };
        tasks.unshift(task);
        return { task, created: true };
      });
    },
    async update(id: string, patch: Partial<T>) {
      return mutate((tasks) => {
        const index = tasks.findIndex((task) => task.id === id);
        if (index < 0) return null;
        tasks[index] = { ...tasks[index], ...patch, id };
        return tasks[index];
      });
    },
    async remove(id: string) {
      return mutate((tasks) => {
        const index = tasks.findIndex((task) => task.id === id);
        if (index < 0) return null;
        const [removed] = tasks.splice(index, 1);
        return removed;
      });
    },
  };
}

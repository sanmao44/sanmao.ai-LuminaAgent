/**
 * 长任务存储基座。
 *
 * 视频任务和高清任务的存储层原先各自复制了一份「读 JSON → 改 → 原子写回」的实现，
 * 其中串行化写入和「临时文件 + rename」是最容易写错的部分。这里抽成一份共用：
 * 磁盘格式（顶层数组、缩进 2、结尾换行、临时文件原子替换）与并发写入语义都保持原样。
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type TaskRecord = { id: string; createdAt: string; idempotencyKey?: string };

export type TaskPageOptions<T> = {
  page?: number;
  pageSize?: number;
  /** 调用方未提供 pageSize 时的默认值。 */
  defaultPageSize?: number;
  maxPageSize?: number;
  /** 领域过滤（按来源、关键词等），分页计算由存储层统一负责。 */
  matches?: (task: T) => boolean;
};

export type TaskPage<T> = { tasks: T[]; total: number; page: number; pageSize: number; totalPages: number };

const DATA_DIR = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');

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
  // 同进程内的写入串行化：并发「读—改—写」会互相覆盖，所有变更都排队执行。
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
      const tasks = await readAll();
      const result = await fn(tasks);
      await writeAll(tasks);
      return result;
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
      const filtered = pageOptions.matches ? tasks.filter(pageOptions.matches) : tasks;
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

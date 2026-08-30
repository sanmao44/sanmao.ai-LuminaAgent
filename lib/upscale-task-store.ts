import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UpscaleModelId, UpscaleProviderId } from './types';

export type UpscaleTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export type UpscaleTask = {
  id: string;
  providerTaskId?: string;
  provider: UpscaleProviderId;
  model: UpscaleModelId;
  scale: 1 | 2 | 3 | 4;
  sourceImageId: string;
  status: UpscaleTaskStatus;
  localImageUrl?: string;
  errorCode?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pollCount: number;
  nextPollAt?: number;
  idempotencyKey: string;
};

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const taskPath = path.join(dataDir, 'upscale-tasks.json');
let mutationChain: Promise<unknown> = Promise.resolve();

async function readTasks(): Promise<UpscaleTask[]> {
  try {
    const value = JSON.parse(await readFile(taskPath, 'utf8'));
    return Array.isArray(value) ? value as UpscaleTask[] : [];
  } catch { return []; }
}

async function writeTasks(tasks: UpscaleTask[]) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${taskPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(tasks, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, taskPath);
}

async function mutate<T>(fn: (tasks: UpscaleTask[]) => Promise<T> | T) {
  const operation = mutationChain.then(async () => {
    const tasks = await readTasks();
    const result = await fn(tasks);
    await writeTasks(tasks);
    return result;
  });
  mutationChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function createUpscaleTask(input: Omit<UpscaleTask, 'id' | 'createdAt' | 'updatedAt' | 'pollCount'>) {
  return mutate((tasks) => {
    const existing = tasks.find((task) => task.idempotencyKey === input.idempotencyKey);
    if (existing) return { task: existing, created: false };
    const now = new Date().toISOString();
    const task: UpscaleTask = { ...input, id: randomUUID(), createdAt: now, updatedAt: now, pollCount: 0 };
    tasks.unshift(task);
    return { task, created: true };
  });
}

export async function findUpscaleTask(id: string) { return (await readTasks()).find((task) => task.id === id) || null; }
export async function listUpscaleTasks(limit = 100) { return (await readTasks()).slice(0, Math.min(500, Math.max(1, limit))); }

export async function updateUpscaleTask(id: string, patch: Partial<UpscaleTask>) {
  return mutate((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    tasks[index] = { ...tasks[index], ...patch, id, updatedAt: new Date().toISOString() };
    return tasks[index];
  });
}

export async function removeUpscaleTask(id: string) {
  return mutate((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const [removed] = tasks.splice(index, 1);
    return removed;
  });
}

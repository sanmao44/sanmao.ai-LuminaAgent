import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VideoGenerationInput } from './types';

export type VideoTaskStatus = 'pending' | 'running' | 'done' | 'failed';
export type VideoTask = {
  id: string;
  providerId: string;
  providerTaskId?: string;
  modelId: string;
  modelName?: string;
  operation: 'generate' | 'edit' | 'extend';
  status: VideoTaskStatus;
  idempotencyKey: string;
  input: VideoGenerationInput;
  videoUrls: string[];
  remoteVideoUrls: string[];
  localVideoPaths: string[];
  costUsd?: number;
  errorCode?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pollCount: number;
  nextPollAt?: number;
};

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const taskPath = path.join(dataDir, 'video-tasks.json');
let mutationChain: Promise<unknown> = Promise.resolve();

async function readTasks() {
  try {
    const value = JSON.parse(await readFile(taskPath, 'utf8'));
    return Array.isArray(value) ? value as VideoTask[] : [];
  } catch { return []; }
}

async function writeTasks(tasks: VideoTask[]) {
  await mkdir(dataDir, { recursive: true });
  const tmp = `${taskPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
  await rename(tmp, taskPath);
}

async function mutate<T>(fn: (tasks: VideoTask[]) => Promise<T> | T) {
  const operation = mutationChain.then(async () => {
    const tasks = await readTasks();
    const result = await fn(tasks);
    await writeTasks(tasks);
    return result;
  });
  mutationChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function createVideoTask(input: Omit<VideoTask, 'id' | 'createdAt' | 'pollCount' | 'videoUrls' | 'remoteVideoUrls' | 'localVideoPaths'>) {
  return mutate((tasks) => {
    const existing = tasks.find((task) => task.idempotencyKey === input.idempotencyKey);
    if (existing) return { task: existing, created: false };
    const task: VideoTask = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), pollCount: 0, videoUrls: [], remoteVideoUrls: [], localVideoPaths: [] };
    tasks.unshift(task);
    return { task, created: true };
  });
}

export async function findVideoTask(id: string) { return (await readTasks()).find((task) => task.id === id) || null; }
export async function listVideoTasks(limit = 100) { return (await readTasks()).slice(0, Math.min(500, Math.max(1, limit))); }
export async function findVideoTaskByIdempotencyKey(key: string) { return (await readTasks()).find((task) => task.idempotencyKey === key) || null; }

export async function updateVideoTask(id: string, patch: Partial<VideoTask>) {
  return mutate((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    tasks[index] = { ...tasks[index], ...patch, id };
    return tasks[index];
  });
}

export async function removeVideoTask(id: string) {
  return mutate((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const [removed] = tasks.splice(index, 1);
    return removed;
  });
}

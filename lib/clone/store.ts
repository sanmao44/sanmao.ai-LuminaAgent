/**
 * 「一键克隆出片」任务的存储层：沿用项目统一的长任务存储基座
 * （`.data/clone-jobs.json`，原子写回、并发串行化）。
 */
import { randomUUID } from 'node:crypto';
import { createTaskStore } from '../task-store';
import type { CloneCapabilities, CloneJob, CloneModels, CloneOptions, CloneReference, CloneStage } from './types';

const store = createTaskStore<CloneJob>({ fileName: 'clone-jobs.json', maxList: 200 });

export type CreateCloneJobInput = {
  reference: CloneReference;
  options: CloneOptions;
  capabilities: CloneCapabilities;
  models: CloneModels;
  warnings: string[];
  idempotencyKey?: string;
};

export async function createCloneJob(input: CreateCloneJobInput) {
  const now = new Date().toISOString();
  const job: CloneJob = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    stage: 'queued',
    progress: 0,
    message: '已排队',
    reference: input.reference,
    options: input.options,
    capabilities: input.capabilities,
    models: input.models,
    warnings: [...input.warnings],
    shots: [],
    timeline: { duration: 0, fps: 30, aspect: input.options.aspect, clips: [] },
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };
  const result = await store.insert(job);
  return result;
}

export async function findCloneJob(id: string) {
  return store.find(id);
}

export async function listCloneJobs(limit = 20) {
  return store.list(limit);
}

export async function updateCloneJob(id: string, patch: Partial<CloneJob>) {
  return store.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function removeCloneJob(id: string) {
  return store.remove(id);
}

/** 列表用的精简视图：不把整条时间轴和素材地址塞进列表响应。 */
export function cloneJobSummary(job: CloneJob) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    shotCount: job.shots.length,
    referenceName: job.reference.name,
    duration: job.timeline.duration,
    warnings: job.warnings,
  };
}

export function cloneStageMessage(stage: CloneStage, message?: string) {
  return message || stage;
}

/**
 * 「一键克隆出片」任务的存储层：沿用项目统一的长任务存储基座
 * （`.data/clone-jobs.json`，原子写回、并发串行化）。
 */
import { randomUUID } from 'node:crypto';
import { createTaskStore } from '../task-store';
import type { CloneAsset, CloneCapabilities, CloneJob, CloneModelIds, CloneModels, CloneOptions, CloneReference, CloneStage } from './types';

const store = createTaskStore<CloneJob>({ fileName: 'clone-jobs.json', maxList: 200 });

/**
 * 已经结束、不该再被幂等键复用的阶段。
 * `failed` 故意不在其中：失败任务（例如服务商限流）再次提交时沿用同一任务续跑，
 * 已经生成好的镜头和配音不会重做。
 */
const CLONE_FINISHED_STAGES: CloneStage[] = ['done', 'cancelled'];

export type CreateCloneJobInput = {
  reference: CloneReference;
  assets?: CloneAsset[];
  options: CloneOptions;
  capabilities: CloneCapabilities;
  models: CloneModels;
  modelIds?: CloneModelIds;
  warnings: string[];
  idempotencyKey?: string;
  planConfirmed?: boolean;
  autoConfirmPlan?: boolean;
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
    assets: input.assets || [],
    planConfirmed: Boolean(input.planConfirmed),
    autoConfirmPlan: input.autoConfirmPlan !== false,
    options: input.options,
    capabilities: input.capabilities,
    models: input.models,
    ...(input.modelIds ? { modelIds: input.modelIds } : {}),
    warnings: [...input.warnings],
    shots: [],
    timeline: { duration: 0, fps: 30, aspect: input.options.aspect, clips: [], tracks: [] },
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };
  return store.mutate((tasks) => {
    const key = job.idempotencyKey;
    const existing = key ? tasks.find((task) => task.idempotencyKey === key) : undefined;
    // 幂等键只挡「正在跑」的重复提交：已经出片/已取消的旧任务如果继续占着键，
    // 用户换一句要求再点「开始」会静默拿回上一次的旧成片。
    if (existing && !CLONE_FINISHED_STAGES.includes(existing.stage)) return { task: existing, created: false };
    if (existing) delete existing.idempotencyKey;
    tasks.unshift(job);
    return { task: job, created: true };
  });
}

/**
 * 长时间等待服务商时的心跳：只刷新 updatedAt，用来区分「还在跑」和「执行进程已经没了」。
 * 没有心跳的话，服务商只是慢了一次就会被误判成中断。
 */
export async function touchCloneJob(id: string) {
  return store.update(id, { updatedAt: new Date().toISOString() });
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
    appliedAt: job.appliedAt,
  };
}

export function cloneStageMessage(stage: CloneStage, message?: string) {
  return message || stage;
}

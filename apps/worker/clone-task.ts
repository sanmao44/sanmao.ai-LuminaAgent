/**
 * Worker-owned Clone task commands and queries.
 *
 * HTTP adapters may validate request payloads and map responses, but they do
 * not read or mutate Clone persistence or decide Clone lifecycle policy.
 * The family store and pipeline remain implementation adapters behind this
 * boundary until their task ports replace them.
 */
import {
  cloneJobSummary,
  createCloneJob,
  findCloneJob,
  listCloneJobs,
  updateCloneJob,
} from '../../lib/clone/store';
import { canResumeCloneJob } from '../../lib/clone/task-runtime';
import type { CreateCloneJobInput } from '../../lib/clone/store';
import type { CloneJob, CloneShot } from '../../lib/clone/types';
import { dispatchCloneExecutionJob, dispatchCloneJob, reapCloneTasks } from './task-entry';

export type CloneTaskMetadataPatch = {
  blueprint?: CloneJob['blueprint'];
  warnings?: string[];
  appliedAt?: string;
};

export type ConfirmCloneTaskInput = {
  shots: CloneShot[];
  warnings?: string[];
};

export type CloneTaskDispatch = (id: string) => void;

const resumeError = '这条任务已经结束了，请重新设置参数再开始。';
const confirmError = '镜头计划尚未生成';

/** Create a Clone task and hand execution to the Worker boundary. */
export async function createCloneTask(input: CreateCloneJobInput, dispatch: CloneTaskDispatch = dispatchCloneJob) {
  const created = await createCloneJob(input);
  dispatch(created.task.id);
  return created;
}

/** List Clone tasks after Worker-owned stale-task reconciliation. */
export async function listCloneTasks(limit = 30) {
  await reapCloneTasks();
  return (await listCloneJobs(limit)).map(cloneJobSummary);
}

/** Read-only task query used by HTTP adapters and other presentation edges. */
export async function getCloneTask(id: string) {
  return findCloneJob(id);
}

/** Update only non-lifecycle Clone metadata from an application edge. */
export async function updateCloneTaskMetadata(id: string, patch: CloneTaskMetadataPatch) {
  return updateCloneJob(id, patch);
}

/** Confirm a generated plan and enqueue execution as one Worker-owned command. */
export async function confirmCloneTask(
  id: string,
  input: ConfirmCloneTaskInput,
  dispatch: CloneTaskDispatch = dispatchCloneExecutionJob,
) {
  const job = await findCloneJob(id);
  if (!job) return null;
  if (job.stage !== 'planned') throw new Error(confirmError);
  const warnings = input.warnings?.length
    ? [...new Set([...job.warnings, ...input.warnings])]
    : job.warnings;
  const updated = await updateCloneJob(id, {
    planConfirmed: true,
    shots: input.shots,
    blueprint: job.blueprint ? { ...job.blueprint, shots: input.shots, updatedAt: new Date().toISOString() } : undefined,
    warnings,
    stage: 'queued',
    message: '已确认镜头计划，等待生成',
  });
  dispatch(id);
  return updated;
}

/** Resume a failed/interrupted Clone task; lifecycle policy lives here. */
export async function resumeCloneTask(
  id: string,
  dispatch: CloneTaskDispatch = dispatchCloneExecutionJob,
) {
  const job = await findCloneJob(id);
  if (!job) return null;
  if (!canResumeCloneJob(job.stage)) throw new Error(resumeError);
  dispatch(id);
  return findCloneJob(id);
}

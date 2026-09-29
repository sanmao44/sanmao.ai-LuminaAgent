import { TaskRuntime } from '../../packages/task-runtime/runtime';
import type { CloneStage } from './types';

/** Compatibility adapter from Clone's persisted stages to the shared Task Runtime. */
export const cloneTaskRuntime = new TaskRuntime<CloneStage>((stage) => {
  switch (stage) {
    case 'planned': return 'waiting';
    case 'done': return 'succeeded';
    case 'analyzing':
    case 'scripting':
    case 'voicing':
    case 'imaging':
    case 'rendering':
    case 'assembling': return 'running';
    case 'queued':
    case 'failed':
    case 'cancelled': return stage;
  }
});

/** A confirmed plan may resume from any stage except explicit completion/cancellation. */
export function canResumeCloneJob(stage: CloneStage) {
  return stage !== 'done' && stage !== 'cancelled';
}

/** Failed Clone jobs keep their idempotency key so a duplicate request can resume them. */
export function reusesCloneJobIdempotencyKey(stage: CloneStage) {
  return stage !== 'done' && stage !== 'cancelled';
}

/** Only queued or executing work can become stale; a plan awaiting user confirmation cannot. */
export function isCloneJobExecutionActive(stage: CloneStage) {
  const state = cloneTaskRuntime.state(stage);
  return state === 'queued' || state === 'running';
}

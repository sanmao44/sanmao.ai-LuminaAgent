import type { TaskRuntimePort, TaskState, TaskStatusResolver } from '../contracts';

const ACTIVE_STATES = new Set<TaskState>(['pending', 'queued', 'running', 'waiting']);
const CANCELABLE_STATES = ACTIVE_STATES;
const RETRYABLE_STATES = new Set<TaskState>(['failed', 'cancelled']);

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  pending: ['queued', 'running', 'failed', 'cancelled'],
  queued: ['running', 'waiting', 'failed', 'cancelled'],
  running: ['waiting', 'succeeded', 'failed', 'cancelled'],
  waiting: ['running', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

/**
 * Provider-neutral task lifecycle policy. Domain adapters supply the mapping
 * from their legacy status values to this stable state vocabulary.
 */
export class TaskRuntime<TStatus extends string> implements TaskRuntimePort<TStatus> {
  constructor(private readonly resolveStatus: TaskStatusResolver<TStatus>) {}

  state(status: TStatus) {
    return this.resolveStatus(status);
  }

  isActive(status: TStatus) {
    return ACTIVE_STATES.has(this.state(status));
  }

  canCancel(status: TStatus) {
    return CANCELABLE_STATES.has(this.state(status));
  }

  canRetry(status: TStatus) {
    return RETRYABLE_STATES.has(this.state(status));
  }

  canTransition(from: TaskState, to: TaskState) {
    return TRANSITIONS[from].includes(to);
  }
}

/** Stable, storage-neutral task lifecycle vocabulary. */

export type TaskState =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TaskOperation = 'cancel' | 'retry';

export type TaskLifecycleEvent =
  | {
      type: 'TaskStateChanged';
      taskId: string;
      from: TaskState;
      to: TaskState;
      at: number;
    }
  | {
      type: 'TaskProgressed';
      taskId: string;
      state: TaskState;
      progress?: number;
      message?: string;
      at: number;
    };

export type TaskStatusResolver<TStatus extends string> = (status: TStatus) => TaskState;

export interface TaskRuntimePort<TStatus extends string = string> {
  state(status: TStatus): TaskState;
  isActive(status: TStatus): boolean;
  canCancel(status: TStatus): boolean;
  canRetry(status: TStatus): boolean;
  canTransition(from: TaskState, to: TaskState): boolean;
}

import { BufferedRuntimeObserver } from '../../packages/contracts/observability';
import type { RuntimeObserver } from '../../packages/contracts/observability';

export type CloneTaskRunner = (jobId: string) => Promise<unknown>;

async function defaultCloneTaskRunner(jobId: string) {
  const { analyzeCloneJob } = await import('../../lib/clone/pipeline');
  return analyzeCloneJob(jobId);
}

async function defaultCloneExecutionRunner(jobId: string) {
  const { runCloneJob } = await import('../../lib/clone/pipeline');
  return runCloneJob(jobId);
}

/** Worker boundary for long-running clone execution. */
export async function runCloneJob(jobId: string, runner: CloneTaskRunner = defaultCloneTaskRunner, observer: RuntimeObserver = new BufferedRuntimeObserver(16)): Promise<void> {
  const operationId = `clone-task-${jobId}`;
  const startedAt = Date.now();
  void observer.emit({ operationId, kind: 'task', phase: 'started', at: startedAt, identity: 'clone' });
  try {
    await runner(jobId);
    void observer.emit({ operationId, kind: 'task', phase: 'completed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'completed', identity: 'clone' });
  } catch (error) {
    void observer.emit({ operationId, kind: 'task', phase: 'failed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'failed', identity: 'clone', errorClass: error instanceof Error ? error.name : 'UnknownError' });
    throw error;
  }
}

export function dispatchCloneJob(jobId: string): void {
  void runCloneJob(jobId).catch(() => undefined);
}

/** Worker entry for a confirmed or resumed clone execution. */
export function dispatchCloneExecutionJob(jobId: string): void {
  void runCloneJob(jobId, defaultCloneExecutionRunner).catch(() => undefined);
}

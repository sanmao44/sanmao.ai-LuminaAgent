import { analyzeCloneJob } from '../../lib/clone/pipeline';
import { BufferedRuntimeObserver } from '../../packages/contracts/observability';

/** Worker boundary for long-running clone execution. */
export function dispatchCloneJob(jobId: string): void {
  const observer = new BufferedRuntimeObserver(16);
  const operationId = `clone-task-${jobId}`;
  const startedAt = Date.now();
  void observer.emit({ operationId, kind: 'task', phase: 'started', at: startedAt, identity: 'clone' });
  void analyzeCloneJob(jobId)
    .then(() => observer.emit({ operationId, kind: 'task', phase: 'completed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'completed', identity: 'clone' }))
    .catch((error) => observer.emit({ operationId, kind: 'task', phase: 'failed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'failed', identity: 'clone', errorClass: error instanceof Error ? error.name : 'UnknownError' }));
}

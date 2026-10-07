import type { RuntimeObserver } from '../../packages/contracts/observability';
import { BufferedRuntimeObserver, CompositeRuntimeObserver } from '../../packages/contracts/observability';
import { FileRuntimeObserver } from '../../packages/observability/runtime-sink';
import { resolveLocalDataDir } from '../../lib/data-paths';
import path from 'node:path';

export async function runTaskLifecycle<T>(identity: 'clone' | 'video' | 'upscale', taskId: string, operation: () => Promise<T>, observer: RuntimeObserver = new CompositeRuntimeObserver([
  new BufferedRuntimeObserver(16),
  new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
])): Promise<T> {
  const operationId = `${identity}-control-${taskId}`;
  const startedAt = Date.now();
  void observer.emit({ operationId, kind: 'task', phase: 'started', at: startedAt, identity });
  try {
    const result = await operation();
    void observer.emit({ operationId, kind: 'task', phase: 'completed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'completed', identity });
    return result;
  } catch (error) {
    void observer.emit({ operationId, kind: 'task', phase: 'failed', at: Date.now(), durationMs: Date.now() - startedAt, status: 'failed', identity, errorClass: error instanceof Error ? error.name : 'UnknownError' });
    throw error;
  }
}

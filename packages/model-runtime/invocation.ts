import type { RuntimeObserver } from '../contracts/observability';

export type ProviderInvocationOptions<T, R> = {
  current: () => T;
  canFailover: boolean;
  advance: () => boolean;
  operation: (runtime: T, signal: AbortSignal) => Promise<R>;
  signal: AbortSignal;
  isCancelled?: (error: unknown) => boolean;
  identity: (runtime: T) => string;
  operationIdPrefix: string;
  observer?: RuntimeObserver;
  nextAttempt: () => number;
  onSuccess?: (runtime: T, durationMs: number) => void;
  onFailure?: (runtime: T, error: unknown, durationMs: number) => void;
};

/**
 * Provider-neutral retry/failover coordination for request adapters.
 * Transport, timeout and health policy stay injected by the caller; this
 * helper owns the shared attempt lifecycle and bounded provider telemetry.
 */
export async function invokeProviderWithFailover<T, R>(options: ProviderInvocationOptions<T, R>): Promise<R> {
  while (true) {
    const runtime = options.current();
    const startedAt = Date.now();
    const attempt = options.nextAttempt();
    const operationId = `${options.operationIdPrefix}-provider-${attempt}`;
    const identity = options.identity(runtime);
    void options.observer?.emit({ operationId, kind: 'provider', phase: 'started', at: startedAt, identity });
    try {
      const result = await options.operation(runtime, options.signal);
      const durationMs = Date.now() - startedAt;
      options.onSuccess?.(runtime, durationMs);
      void options.observer?.emit({ operationId, kind: 'provider', phase: 'completed', at: Date.now(), durationMs, status: 'completed', identity });
      return result;
    } catch (error) {
      if (options.isCancelled?.(error)) throw error;
      const durationMs = Date.now() - startedAt;
      options.onFailure?.(runtime, error, durationMs);
      void options.observer?.emit({ operationId, kind: 'provider', phase: 'failed', at: Date.now(), durationMs, status: 'failed', identity, errorClass: error instanceof Error ? error.name : 'UnknownError' });
      if (!options.canFailover || !options.advance()) throw error;
    }
  }
}

/** Provider-neutral candidate selection for capability-specific media calls. */
export async function invokeModelCandidates<T extends { model: { id: string } }, R>(
  initial: T,
  loadFallbacks: () => Promise<readonly T[]>,
  operation: (runtime: T) => Promise<R>,
  isFallbackSafe: (error: unknown) => boolean,
): Promise<R> {
  const candidates: T[] = [initial];
  let fallbacksLoaded = false;
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      return await operation(candidates[index]);
    } catch (error) {
      if (!isFallbackSafe(error)) throw error;
      if (index < candidates.length - 1) continue;
      if (fallbacksLoaded) throw error;
      fallbacksLoaded = true;
      const fallbacks = await loadFallbacks();
      candidates.push(...fallbacks.filter((candidate) => candidate.model.id !== initial.model.id));
      if (index >= candidates.length - 1) throw error;
    }
  }
  throw new Error('No provider candidate available');
}

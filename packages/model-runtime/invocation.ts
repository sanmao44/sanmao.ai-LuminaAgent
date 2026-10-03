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

export type ProviderResponseDeadlineOptions<T> = {
  signal: AbortSignal;
  timeoutMs: number;
  idleTimeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  timeoutError: (phase: 'initial' | 'idle', timeoutMs: number) => Error;
};

/**
 * Bounds both the initial provider response and gaps between streaming chunks.
 * The provider adapter owns the transport call; this helper owns cancellation
 * and reader cleanup so every streaming capability uses the same lifecycle.
 */
export async function withProviderResponseDeadline<T>(options: ProviderResponseDeadlineOptions<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutError = options.timeoutError('initial', options.timeoutMs);
  const abortFromParent = () => controller.abort(options.signal.reason || new Error('AGENT_CANCELLED'));
  const timer = setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
  let ownsResponseBody = false;
  const readWithTimeout = async (reader: ReadableStreamDefaultReader<Uint8Array>, waitMs: number, error: Error) => {
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race<ReadableStreamReadResult<Uint8Array>>([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          waitTimer = setTimeout(() => {
            reject(error);
            queueMicrotask(() => {
              if (!controller.signal.aborted) controller.abort(error);
            });
          }, waitMs);
        }),
      ]);
    } finally {
      if (waitTimer) clearTimeout(waitTimer);
    }
  };
  if (options.signal.aborted) abortFromParent();
  else options.signal.addEventListener('abort', abortFromParent, { once: true });
  try {
    const result = await options.operation(controller.signal);
    if (result instanceof Response && result.body) {
      const reader = result.body.getReader();
      const abortReader = () => void reader.cancel(controller.signal.reason).catch(() => undefined);
      controller.signal.addEventListener('abort', abortReader, { once: true });
      const cleanupReader = () => {
        controller.signal.removeEventListener('abort', abortReader);
        try { reader.releaseLock(); } catch {}
      };
      let firstChunk: ReadableStreamReadResult<Uint8Array>;
      try {
        firstChunk = await readWithTimeout(reader, options.timeoutMs, timeoutError);
        if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
        if (firstChunk.done) {
          cleanupReader();
          return new Response(null, { status: result.status, statusText: result.statusText, headers: new Headers(result.headers) }) as T;
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        cleanupReader();
        throw error;
      }
      ownsResponseBody = true;
      clearTimeout(timer);
      const cleanupBody = () => {
        cleanupReader();
        options.signal.removeEventListener('abort', abortFromParent);
      };
      let firstChunkPending = true;
      const body = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            if (firstChunkPending) {
              firstChunkPending = false;
              if (firstChunk.value) streamController.enqueue(firstChunk.value);
              else streamController.close();
              return;
            }
            const next = await readWithTimeout(reader, options.idleTimeoutMs, options.timeoutError('idle', options.idleTimeoutMs));
            if (next.done) {
              cleanupBody();
              streamController.close();
            } else if (next.value) streamController.enqueue(next.value);
          } catch (error) {
            await reader.cancel(error).catch(() => undefined);
            cleanupBody();
            streamController.error(error);
          }
        },
        cancel(reason) {
          void reader.cancel(reason).catch(() => undefined).finally(cleanupBody);
        },
      });
      return new Response(body, { status: result.status, statusText: result.statusText, headers: new Headers(result.headers) }) as T;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    if (!ownsResponseBody) {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abortFromParent);
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
      let fallbacks: readonly T[];
      try { fallbacks = await loadFallbacks(); } catch { throw error; }
      candidates.push(...fallbacks.filter((candidate) => candidate.model.id !== initial.model.id));
      if (index >= candidates.length - 1) throw error;
    }
  }
  throw new Error('No provider candidate available');
}

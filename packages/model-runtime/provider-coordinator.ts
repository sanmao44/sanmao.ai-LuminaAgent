import { invokeProviderWithFailover, withProviderResponseDeadline } from './invocation';
import type { RuntimeObserver } from '../contracts/observability';

export type ProviderRuntime = {
  model: { id: string; displayName: string };
  provider: { id: string; name: string };
};

export type ProviderCoordinatorOptions<T extends ProviderRuntime> = {
  requestedModelId: string;
  candidates: readonly T[];
  signal: AbortSignal;
  operationIdPrefix: string;
  observer?: RuntimeObserver;
  nextAttempt: () => number;
  reportFallback?: (from: T, to: T) => void;
  isCancelled?: (error: unknown) => boolean;
  timeoutMs: number;
  failoverTimeoutMs: number;
  idleTimeoutMs: number;
  timeoutError: (phase: 'initial' | 'idle', timeoutMs: number) => Error;
  health?: {
    order: (candidates: readonly T[]) => readonly T[];
    onSuccess: (runtime: T, durationMs: number) => void;
    onFailure: (runtime: T, error: unknown, durationMs: number) => void;
  };
};

/**
 * Authoritative provider candidate and attempt policy for an Agent request.
 * HTTP routes provide transport operations; this coordinator owns ordering,
 * bounded failover and attempt deadlines without knowing provider SDKs.
 */
export class ProviderCoordinator<T extends ProviderRuntime> {
  private readonly ordered: readonly T[];
  private index = 0;

  constructor(private readonly options: ProviderCoordinatorOptions<T>) {
    this.ordered = options.requestedModelId === 'auto'
      ? options.health?.order(options.candidates) || [...options.candidates]
      : [...options.candidates];
  }

  get current(): T { return this.ordered[this.index]!; }
  get automatic() { return this.options.requestedModelId === 'auto'; }
  get candidates() { return this.ordered; }
  get hasCandidate() { return Boolean(this.current); }
  canFailover(payload: { tools?: readonly unknown[] } | undefined) {
    return this.automatic && this.ordered.length > 1 && !payload?.tools?.length;
  }
  advance() {
    if (!this.automatic || this.index >= this.ordered.length - 1) return false;
    const previous = this.current;
    this.index += 1;
    const next = this.current;
    if (previous && next) this.options.reportFallback?.(previous, next);
    return true;
  }
  async invoke<TResponse>(
    payload: { tools?: readonly unknown[] },
    signal: AbortSignal,
    operation: (runtime: T, callSignal: AbortSignal) => Promise<TResponse>,
  ) {
    const canFailover = this.canFailover(payload);
    return invokeProviderWithFailover({
      current: () => this.current,
      canFailover,
      advance: () => this.advance(),
      signal,
      operation: (runtime, callSignal) => withProviderResponseDeadline({
        signal,
        timeoutMs: canFailover ? this.options.failoverTimeoutMs : this.options.timeoutMs,
        idleTimeoutMs: this.options.idleTimeoutMs,
        operation: (deadlineSignal) => operation(runtime, deadlineSignal || callSignal),
        timeoutError: this.options.timeoutError,
      }),
      isCancelled: this.options.isCancelled,
      identity: (runtime) => runtime.provider.name,
      operationIdPrefix: this.options.operationIdPrefix,
      observer: this.options.observer,
      nextAttempt: this.options.nextAttempt,
      onSuccess: this.options.health?.onSuccess,
      onFailure: this.options.health?.onFailure,
    });
  }
  async invokeSpecific<TResponse>(runtime: T, signal: AbortSignal, operation: (runtime: T, callSignal: AbortSignal) => Promise<TResponse>) {
    return invokeProviderWithFailover({
      current: () => runtime,
      canFailover: false,
      advance: () => false,
      signal,
      operation: (_runtime, callSignal) => withProviderResponseDeadline({
        signal,
        timeoutMs: this.options.timeoutMs,
        idleTimeoutMs: this.options.idleTimeoutMs,
        operation: (deadlineSignal) => operation(runtime, deadlineSignal || callSignal),
        timeoutError: this.options.timeoutError,
      }),
      isCancelled: this.options.isCancelled,
      identity: (selected) => selected.provider.name,
      operationIdPrefix: this.options.operationIdPrefix,
      observer: this.options.observer,
      nextAttempt: this.options.nextAttempt,
      onSuccess: this.options.health?.onSuccess,
      onFailure: this.options.health?.onFailure,
    });
  }
}

export function createProviderCoordinator<T extends ProviderRuntime>(options: ProviderCoordinatorOptions<T>) {
  return new ProviderCoordinator(options);
}


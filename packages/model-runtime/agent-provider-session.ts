import { createProviderCoordinator, type ProviderCoordinator, type ProviderHealthPort, type ProviderRuntime } from './provider-coordinator';
import type { RuntimeObserver } from '../contracts/observability';

export type AgentProviderSessionOptions<T extends ProviderRuntime> = {
  requestedModelId: string;
  loadCandidates: () => Promise<readonly T[]>;
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
  health?: ProviderHealthPort<T>;
};

export type AgentProviderSession<T extends ProviderRuntime> = {
  candidates: readonly T[];
  coordinator: ProviderCoordinator<T>;
};

export async function createAgentProviderSession<T extends ProviderRuntime>(options: AgentProviderSessionOptions<T>): Promise<AgentProviderSession<T>> {
  const candidates = await options.loadCandidates();
  const coordinator = createProviderCoordinator({
    requestedModelId: options.requestedModelId,
    candidates,
    signal: options.signal,
    operationIdPrefix: options.operationIdPrefix,
    observer: options.observer,
    nextAttempt: options.nextAttempt,
    reportFallback: options.reportFallback,
    isCancelled: options.isCancelled,
    timeoutMs: options.timeoutMs,
    failoverTimeoutMs: options.failoverTimeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    timeoutError: options.timeoutError,
    health: options.health,
  });
  return { candidates, coordinator };
}

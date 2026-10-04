import {
  chatCompletion,
  chatCompletionStream,
  type ChatMessage,
} from '@/lib/providers';
import { resolveLocalDataDir } from '@/lib/data-paths';
import path from 'node:path';
import { BufferedRuntimeObserver, CompositeRuntimeObserver, type RuntimeObserver } from '@/packages/contracts/observability';
import { FileRuntimeObserver } from '@/packages/observability/index';
import { createProviderCoordinator, type ProviderRuntime } from '@/packages/model-runtime/provider-coordinator';
import { createAgentModelInvoker } from '@/packages/model-runtime/agent-invoker';

export type AgentCompositionRuntime = ProviderRuntime & {
  provider: Parameters<typeof chatCompletion>[0];
  model: {
    id: string;
    rawId: string;
    displayName: string;
    contextWindow?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    capabilities: readonly string[];
  };
};

type ChatPayload = Parameters<typeof chatCompletion>[2];
type ChatResponse = Awaited<ReturnType<typeof chatCompletion>>;
type StreamResponse = Awaited<ReturnType<typeof chatCompletionStream>>;

export type AgentApplicationCompositionOptions<TRuntime extends AgentCompositionRuntime> = {
  requestedModelId: string;
  candidates: readonly TRuntime[];
  signal: AbortSignal;
  operationIdPrefix: string;
  nextAttempt: () => number;
  reportFallback?: (from: TRuntime, to: TRuntime) => void;
  isCancelled?: (error: unknown) => boolean;
  timeoutMs: number;
  failoverTimeoutMs: number;
  idleTimeoutMs: number;
  timeoutError: (phase: 'initial' | 'idle', timeoutMs: number) => Error;
  orderCandidates: (candidates: readonly TRuntime[]) => readonly TRuntime[];
  onModelHealthSuccess: (runtime: TRuntime, durationMs: number) => void;
  onModelHealthFailure: (runtime: TRuntime, error: unknown, durationMs: number) => void;
  onCurrent?: (runtime: TRuntime) => void;
  onUsage?: (response: ChatResponse) => void;
  invokeProvider?: (runtime: TRuntime, payload: ChatPayload, signal: AbortSignal) => Promise<ChatResponse>;
  invokeProviderStream?: (runtime: TRuntime, payload: ChatPayload, signal: AbortSignal) => Promise<StreamResponse>;
};

export type AgentApplicationComposition<TRuntime extends AgentCompositionRuntime> = {
  observer: RuntimeObserver;
  invokeChatModel: (payload: ChatPayload, signal?: AbortSignal) => Promise<ChatResponse>;
  invokeChatModelStream: (payload: ChatPayload, signal?: AbortSignal) => Promise<StreamResponse>;
  invokeSpecificChatModel: (runtime: TRuntime, payload: ChatPayload, signal: AbortSignal) => Promise<ChatResponse>;
};

/**
 * Composition root for the Agent application. Concrete provider transports,
 * health persistence callbacks and operational observers are assembled here;
 * the application execution path only consumes the returned model ports.
 */
export function createAgentApplicationComposition<TRuntime extends AgentCompositionRuntime>(
  options: AgentApplicationCompositionOptions<TRuntime>,
): AgentApplicationComposition<TRuntime> {
  const observer = new CompositeRuntimeObserver([
    new BufferedRuntimeObserver(256),
    new FileRuntimeObserver({ directory: path.join(resolveLocalDataDir(), 'runtime-events') }),
  ]);
  const coordinator = createProviderCoordinator({
    requestedModelId: options.requestedModelId,
    candidates: options.candidates,
    signal: options.signal,
    operationIdPrefix: options.operationIdPrefix,
    observer,
    nextAttempt: options.nextAttempt,
    reportFallback: options.reportFallback,
    isCancelled: options.isCancelled,
    timeoutMs: options.timeoutMs,
    failoverTimeoutMs: options.failoverTimeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    timeoutError: options.timeoutError,
    health: {
      order: options.orderCandidates,
      onSuccess: options.onModelHealthSuccess,
      onFailure: options.onModelHealthFailure,
    },
  });
  const invoker = createAgentModelInvoker<TRuntime, ChatPayload, ChatResponse>({
    coordinator,
    defaultSignal: options.signal,
    invoke: options.invokeProvider || ((runtime, payload, signal) => chatCompletion(runtime.provider, runtime.model.rawId, payload, signal)),
    onCurrent: options.onCurrent,
    onUsage: options.onUsage,
  });
  return {
    observer,
    invokeChatModel: (payload, signal) => invoker.invoke(payload, signal),
    invokeChatModelStream: (payload, signal) => invoker.invokeWith(
      payload,
      (runtime, callSignal) => (options.invokeProviderStream || ((selected, body, streamSignal) => chatCompletionStream(selected.provider, selected.model.rawId, body, streamSignal)))(runtime, payload, callSignal),
      signal,
    ),
    invokeSpecificChatModel: (runtime, payload, signal) => invoker.invokeSpecificWith(
      runtime,
      payload,
      (selectedRuntime, callSignal) => (options.invokeProvider || ((selected, body, invokeSignal) => chatCompletion(selected.provider, selected.model.rawId, body, invokeSignal)))(selectedRuntime, payload, callSignal),
      signal,
    ),
  };
}

export type AgentChatMessage = ChatMessage;

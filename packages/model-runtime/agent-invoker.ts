import type { ProviderCoordinator, ProviderRuntime } from './provider-coordinator';

export type AgentInvokerOptions<TRuntime extends ProviderRuntime, TPayload extends { tools?: readonly unknown[] }, TResponse> = {
  coordinator: ProviderCoordinator<TRuntime>;
  defaultSignal: AbortSignal;
  invoke: (runtime: TRuntime, payload: TPayload, signal: AbortSignal) => Promise<TResponse>;
  onUsage?: (response: TResponse) => void;
  onCurrent?: (runtime: TRuntime) => void;
};

/**
 * Application-facing model invocation boundary. Candidate selection, deadline
 * and failover policy stay in ProviderCoordinator; this adapter owns only the
 * transport callback and keeps API application code independent of those
 * mechanics.
 */
export function createAgentModelInvoker<TRuntime extends ProviderRuntime, TPayload extends { tools?: readonly unknown[] }, TResponse>(options: AgentInvokerOptions<TRuntime, TPayload, TResponse>) {
  const invokeWith = async <TResult>(payload: TPayload, operation: (runtime: TRuntime, signal: AbortSignal) => Promise<TResult>, signal = options.defaultSignal) => {
    const response = await options.coordinator.invoke(payload, signal, operation);
    options.onCurrent?.(options.coordinator.current);
    options.onUsage?.(response as unknown as TResponse);
    return response as TResult;
  };
  const invoke = (payload: TPayload, signal = options.defaultSignal) => invokeWith(payload, (runtime, callSignal) => options.invoke(runtime, payload, callSignal), signal);
  const invokeSpecificWith = <TResult>(runtime: TRuntime, payload: TPayload, operation: (runtime: TRuntime, signal: AbortSignal) => Promise<TResult>, signal = options.defaultSignal) => options.coordinator.invokeSpecific(runtime, signal, operation);
  const invokeSpecific = (runtime: TRuntime, payload: TPayload, signal = options.defaultSignal) => invokeSpecificWith(runtime, payload, (selected, callSignal) => options.invoke(selected, payload, callSignal), signal);
  return { invoke, invokeWith, invokeSpecific, invokeSpecificWith };
}

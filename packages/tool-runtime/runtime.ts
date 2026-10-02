import { resolveToolPolicy, type ToolPolicyDecision } from '@/lib/tools/policy';
import { parseToolArguments } from '@/lib/tools/call-arguments';
import type { ToolDefinition, ToolGatingContext } from '@/lib/tools/registry';
import { runToolLoop, type RunToolLoopOptions, type ToolLoopCall, type ToolLoopMessage, type ToolLoopTraceStep } from './tool-loop';

export type ToolRuntimeCall = ToolLoopCall & { function: { name: string; arguments?: string } };
export type ToolRuntimeExecution = { results: ToolLoopMessage[]; deferred?: true; stalled?: true };
export type ToolRuntimeBatchExecution = {
  results: ToolLoopMessage[];
  deferredCalls: ToolRuntimeCall[];
  stalled: boolean;
};
export type ToolRuntimeAuthorization = 'allow' | 'defer' | { deny: string; args?: Record<string, unknown> } | { allow: true; args?: Record<string, unknown> };
export type ToolRuntimeDependencies = {
  context: ToolGatingContext;
  extraTools?: readonly ToolDefinition[];
  authorize?: (input: { call: ToolRuntimeCall; policy: ToolPolicyDecision; args: Record<string, unknown> }) => Promise<ToolRuntimeAuthorization> | ToolRuntimeAuthorization;
  onPolicyDenied?: (input: { call: ToolRuntimeCall; policy: ToolPolicyDecision }) => void | Promise<void>;
  execute: (input: { call: ToolRuntimeCall; policy: ToolPolicyDecision; args: Record<string, unknown>; executionContext?: unknown }) => Promise<ToolRuntimeExecution>;
  onExecuted?: (input: { call: ToolRuntimeCall; result: ToolRuntimeExecution; executionContext: { stepCalls: readonly ToolRuntimeCall[]; callIndex: number } }) => void | Promise<void>;
};

export class ToolRuntime {
  constructor(private readonly dependencies: ToolRuntimeDependencies) {}
  resolve(call: ToolRuntimeCall) { return resolveToolPolicy(call.function.name, this.dependencies.context, this.dependencies.extraTools || []); }
  async execute(call: ToolRuntimeCall, executionContext?: unknown): Promise<ToolRuntimeExecution> {
    const policy = this.resolve(call);
    if (!policy.allowed) {
      await this.dependencies.onPolicyDenied?.({ call, policy });
      return { results: [{ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: policy.reason }) }] };
    }
    const raw = parseToolArguments(call.function.arguments);
    const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const authorization = await this.dependencies.authorize?.({ call, policy, args });
    if (authorization === 'defer') return { results: [], deferred: true };
    if (authorization && typeof authorization === 'object' && 'deny' in authorization) return { results: [{ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: authorization.deny }) }] };
    const authorizedArgs = authorization && typeof authorization === 'object' && 'args' in authorization && authorization.args ? authorization.args : args;
    try { return await this.dependencies.execute({ call, policy, args: authorizedArgs, executionContext }); }
    catch (error) { return { results: [{ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }] }; }
  }
  async executeCalls(calls: readonly ToolRuntimeCall[]): Promise<ToolRuntimeBatchExecution> {
    const results: ToolLoopMessage[] = [];
    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const call = calls[callIndex];
      const executionContext = { stepCalls: calls, callIndex };
      const result = await this.execute(call, executionContext);
      await this.dependencies.onExecuted?.({ call, result, executionContext });
      results.push(...result.results);
      if (result.deferred) return { results, deferredCalls: calls.slice(callIndex) as ToolRuntimeCall[], stalled: false };
      if (result.stalled) return { results, deferredCalls: [], stalled: true };
    }
    return { results, deferredCalls: [], stalled: false };
  }
  runLoop(options: RunToolLoopOptions) { return runToolLoop(options); }
}

export type { RunToolLoopOptions, ToolLoopTraceStep } from './tool-loop';

/**
 * Stable Agent Runtime boundary.
 *
 * This contract intentionally contains protocol-neutral values only. HTTP,
 * provider SDKs, MCP and persistence adapters stay outside this package.
 */

import type { ModelCapabilities, ModelDescriptor, ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelRuntime } from './model';

export type { ModelCapabilities, ModelDescriptor, ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelRuntime } from './model';

export type AgentRunId = string;

export type AgentRunState =
  | 'created'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentMessageRole = ModelMessage['role'];
export type AgentMessage = ModelMessage;

export type AgentEvent =
  | { type: 'AgentRunStarted'; runId: AgentRunId; at: number }
  | { type: 'ModelInvocationStarted'; runId: AgentRunId; at: number }
  | { type: 'ModelInvocationCompleted'; runId: AgentRunId; at: number; outputChars: number }
  | { type: 'AgentRunCompleted'; runId: AgentRunId; at: number }
  | { type: 'AgentRunFailed'; runId: AgentRunId; at: number; error: string };

export type AgentRequest = {
  runId: AgentRunId;
  messages: readonly AgentMessage[];
  model: ModelDescriptor;
  signal?: AbortSignal;
};

export type AgentResult = {
  run: {
    id: AgentRunId;
    state: AgentRunState;
  };
  output: string;
  modelId?: string;
  events: readonly AgentEvent[];
};

export interface ContextBuilder {
  build(request: AgentRequest): readonly AgentMessage[];
}

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
};

export interface AgentPolicy {
  decide(request: AgentRequest): PolicyDecision;
}

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  callId: string;
  ok: boolean;
  output: string;
};

export interface ToolRuntime {
  discover(): readonly AgentToolDefinition[];
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}

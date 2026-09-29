/**
 * Stable Agent Runtime boundary.
 *
 * This contract intentionally contains protocol-neutral values only. HTTP,
 * provider SDKs, MCP and persistence adapters stay outside this package.
 */

export type AgentRunId = string;

export type AgentRunState =
  | 'created'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentMessageRole = 'system' | 'user' | 'assistant';

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
};

export type AgentEvent =
  | { type: 'AgentRunStarted'; runId: AgentRunId; at: number }
  | { type: 'ModelInvocationStarted'; runId: AgentRunId; at: number }
  | { type: 'ModelInvocationCompleted'; runId: AgentRunId; at: number; outputChars: number }
  | { type: 'AgentRunCompleted'; runId: AgentRunId; at: number }
  | { type: 'AgentRunFailed'; runId: AgentRunId; at: number; error: string };

export type ModelCapabilities = {
  text: boolean;
  reasoning: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
};

export type ModelDescriptor = {
  id: string;
  displayName: string;
  capabilities: ModelCapabilities;
};

export type ModelRequest = {
  runId: AgentRunId;
  messages: readonly AgentMessage[];
  model: ModelDescriptor;
  signal?: AbortSignal;
};

export type ModelResponse = {
  content: string;
  modelId?: string;
};

export interface ModelProvider {
  invoke(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelRuntime {
  descriptor: ModelDescriptor;
  provider: ModelProvider;
  invoke(request: Omit<ModelRequest, 'model'>): Promise<ModelResponse>;
}

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

export type ToolDefinition = {
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
  discover(): readonly ToolDefinition[];
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}

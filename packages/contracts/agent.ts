/**
 * Stable Agent Runtime boundary.
 *
 * This contract intentionally contains protocol-neutral values only. HTTP,
 * provider SDKs, MCP and persistence adapters stay outside this package.
 */

import type { ModelCapabilities, ModelDescriptor, ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelRuntime } from './model';

export type { ModelCapabilities, ModelDescriptor, ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelRuntime } from './model';

export type AgentRunId = string;

export type AgentAssistantRunAction = 'pause' | 'resume' | 'cancel';

/** Lifecycle of a user-facing assistant task, separate from tool approval. */
export type AgentAssistantRunStatus = {
  runId: AgentRunId;
  state: 'running' | 'pausing' | 'paused' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  completedToolCalls: number;
  updatedAt: string;
  error?: string;
};

export type AgentAssistantRunReply = {
  run: AgentAssistantRunStatus;
  result?: Record<string, unknown>;
};

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

/** The user-facing portion of a pending tool call. */
export type AgentApprovalCall = {
  id: string;
  server: string;
  tool: string;
  risk: string;
  reason: string;
  argsPreview?: string;
  filesystemDiff?: string;
  operation?: {
    type: 'project-typecheck';
    directory: string;
  };
};

/** Fixed local TypeScript check; callers cannot supply a command or arguments. */
export type AgentProjectTypecheckRequest = { directory: string };

export type AgentProjectTypecheckResult = {
  directory: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  outputTruncated: boolean;
  error?: string;
};

export type AgentProjectTypecheckSelection =
  | { ok: true; directory: string }
  | { ok: false; reason: string };

/** Application port backed by the locally installed trusted TypeScript compiler. */
export interface AgentProjectTypecheckPort {
  listAuthorizedRoots(): readonly string[];
  selectDirectory(input: {
    instruction: string;
    cwd: string;
    authorizedRoots: readonly string[];
  }): AgentProjectTypecheckSelection;
  validateDirectory(directory: string, authorizedRoots: readonly string[]): AgentProjectTypecheckSelection;
  run(input: AgentProjectTypecheckRequest, options?: { signal?: AbortSignal }): Promise<AgentProjectTypecheckResult>;
}

/** One user action to restore a reviewed local file edit. */
export type AgentFilesystemUndo = {
  id: string;
  expiresAt: number;
  path: string;
};

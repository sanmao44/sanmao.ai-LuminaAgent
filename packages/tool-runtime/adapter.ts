import { browserToolName, isBrowserMutationTool } from '@/lib/agent/browser-freshness';
import { executeMcpManageCapability, executeMcpCapability, executeTabbitCapability } from './mcp-capability';
import type { ChatMessage } from '@/lib/providers';
import type { CanvasPatch } from '@/lib/canvas/patch';
import type { ToolPolicyDecision } from '@/lib/tools/policy';
import type { ToolRuntimeCall } from './runtime';
import type { RuntimeObserver } from '../contracts/observability';
import type { ToolRuntimeState, ToolCall, GeneratedFile, RuntimeImage } from './capability-state';
import { executeCanvasCapability, executeFileCapability, executeWebCapability } from './native-capabilities';
import { executeImageCapability } from './image-capability';
import { executeSkillCapability } from './skill-capability';
import { executeArtifactCapability } from './artifact-capability';
type TabbitResult = { ok: boolean; response?: unknown; error?: unknown };
type McpMeta = { serverId: string; serverName: string; toolName: string; readOnly: boolean; blocked: boolean };
type McpServer = Parameters<typeof import('./mcp-executor').executeMcpTool>[0]['server'];
type AdapterState = ToolRuntimeState & Record<string, unknown>;
export type ToolExecutionAdapterBindings = {
  observer?: RuntimeObserver;
  toolExecutionKind: (name: unknown, tools: readonly unknown[]) => string | null; mcpTools: readonly unknown[]; reportToolProgress: (patch: unknown) => void; agentToolProgress: (kind: unknown, name: string) => unknown;
  webDecision: { query?: string }; latest?: { content?: unknown }; requestController: AbortController; searchWeb: (query: string, signal: AbortSignal) => Promise<unknown>; formatWebSearchContext: (data: unknown) => string;
  normalizeGeneratedFile: (raw: unknown, index: number) => GeneratedFile | null; skillContext: import('@/lib/skills').SkillContext; skillInstaller: { kind: 'agent'; name: string; detail: string }; canvasDocument?: unknown; parseToolArguments: (raw?: string) => unknown;
  validateCanvasPatch: (document: unknown, patch: CanvasPatch) => { ok: true } | { ok: false; error: string; operationIndex?: number }; agentRunId?: string; MCP_MANAGE_LABELS: Record<string, string>; isMcpRuntimeAction: (action: string) => boolean;
  runMcpRuntimeAction: (action: string, options: Record<string, unknown>) => Promise<{ result: Record<string, unknown> }>; latestInstruction?: string; runMcpManageAction: (args: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ result: Record<string, unknown> }>;
  executionPublicState: { settings: { imageStoragePath?: string } }; runTabbitBrowserAction: (args: Record<string, unknown>, options: { signal?: AbortSignal }) => Promise<TabbitResult>; mcpToolCallLimit: number;
  browserMetrics: { record: (name: string, ok: boolean, text: string, durationMs: number) => string }; auditMcpCall: (meta: Omit<McpMeta, 'blocked'>, details: Record<string, unknown>) => void; mcpServerById: Map<string, McpServer>; browserMutationBatches: WeakSet<object>;
  mcpTurnBudgetLimit: number; mcpFilesystemRoots: readonly string[]; localDataDir?: string; persistImageBuffer: (bytes: Buffer, contentType: string, configuredPath?: string) => Promise<{ url: string }>;
  mcpRepeatTracker: Map<string, { count: number; text: string }>; agentTurnStartedAt: number; ARTIFACT_MAX_PER_TURN: number; appendPageContext: (current: string, source: string, text: string) => string; reportProgress: (patch: unknown) => void;
  imageToolsAllowed: boolean; batchPlanContent?: string; isBareImageExecution: (input: string) => boolean; extractBatchPrompts: (content: string) => string[]; fallbackImagePrompt: string; requestedImageCapability?: 'generate' | 'edit'; latestRefs: readonly Record<string, unknown>[];
  trackedChatCompletion: (provider: unknown, model: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<{ choices?: Array<{ message?: { content?: unknown } }> } | null>; agentRuntime: { provider: unknown; model: { rawId: string } }; requestedAgentImageModelId?: string;
  imageModels: readonly { id?: string; capabilities?: readonly string[] }[]; getRuntimeImageGenerationModel: (id?: string | null) => Promise<{ provider: unknown; model: { id: string; rawId: string; displayName: string } } | null>; getRuntimeImageModelForCapability: (id: string | null | undefined, capability: string) => Promise<{ provider: unknown; model: { id: string; rawId: string; displayName: string } } | null>;
  appendGenerationLog: (log: Record<string, unknown>) => Promise<void>; sourceForLog: string; taskContext: Record<string, unknown>; startGenerationLog: (log: Record<string, unknown>) => Promise<string>; referenceRecords: readonly Record<string, unknown>[];
  getRuntimeImageModelCandidates: (id: string, capability: string) => readonly RuntimeImage[];
  editImage: (provider: unknown, model: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<RuntimeImage[]>; generateImage: (provider: unknown, model: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<RuntimeImage[]>;
  persistGenerationResult: (options: Record<string, unknown>) => Promise<{ images: RuntimeImage[] }>; imageDownloadAuth: (provider: unknown) => unknown; finishGenerationLog: (id: string, patch: Record<string, unknown>) => Promise<void>;
  imageStoragePath?: string;
};
export type ToolCallRun = { results: ChatMessage[]; deferred?: true; stalled?: true };
export type ToolExecutionAdapterDependencies = { state: Record<string, unknown> } & Record<string, unknown>;
export function createToolExecutionAdapter(dependencies: ToolExecutionAdapterDependencies) {
  const state = dependencies.state as AdapterState;
  const { state: _state, ...deps } = dependencies;
  const { observer, toolExecutionKind, mcpTools, reportToolProgress, agentToolProgress, webDecision, latest, requestController, searchWeb, formatWebSearchContext, normalizeGeneratedFile, skillContext, skillInstaller, canvasDocument, parseToolArguments, validateCanvasPatch, agentRunId, MCP_MANAGE_LABELS, isMcpRuntimeAction, runMcpRuntimeAction, latestInstruction, runMcpManageAction, executionPublicState, runTabbitBrowserAction, mcpToolCallLimit, browserMetrics, auditMcpCall, mcpServerById, browserMutationBatches, mcpTurnBudgetLimit, mcpFilesystemRoots, localDataDir, persistImageBuffer, mcpRepeatTracker, agentTurnStartedAt, ARTIFACT_MAX_PER_TURN, appendPageContext, reportProgress, imageToolsAllowed, batchPlanContent, isBareImageExecution, extractBatchPrompts, fallbackImagePrompt, requestedImageCapability, latestRefs, trackedChatCompletion, agentRuntime, requestedAgentImageModelId, imageModels, getRuntimeImageGenerationModel, getRuntimeImageModelForCapability, appendGenerationLog, sourceForLog, taskContext, startGenerationLog, referenceRecords, getRuntimeImageModelCandidates, editImage, generateImage, persistGenerationResult, imageDownloadAuth, finishGenerationLog, imageStoragePath } = deps as unknown as ToolExecutionAdapterBindings;
  return async (input: { call: ToolRuntimeCall; policy: ToolPolicyDecision; args: Record<string, unknown>; executionContext?: unknown }): Promise<ToolCallRun> => {
    const { call, policy, args } = input;
    const executionContext = input.executionContext as { stepCalls: readonly ToolCall[]; callIndex: number } | undefined;
    const stepCalls = executionContext?.stepCalls || [call];
    const callIndex = executionContext?.callIndex || 0;
    let { webSearchData, webSearchError, generatedFiles, canvasPatch, mcpToolCallCount, mcpTurnBudget, usedMcpTools, browserUses, browserRecoveryNeeded, generated, browserDownloadCount, stalledMcpReason, preparedCaption, batchItems, generations, recentPageText } = state;
    const results: ChatMessage[] = [];
      const kind = toolExecutionKind(call?.function?.name, mcpTools);
      reportToolProgress(agentToolProgress(kind, String(call?.function?.name || '')));
      if (kind === 'web') {
        const execution = await executeWebCapability({
          callId: call.id,
          args,
          signal: requestController.signal,
          latestContent: latest?.content,
          searchQuery: webDecision.query,
          searchWeb,
          formatWebSearchContext,
        });
        if (execution.webSearchData !== undefined) webSearchData = execution.webSearchData;
        if (execution.webSearchError) webSearchError = execution.webSearchError;
        results.push(execution.message);
        return { results };
      }
      if (kind === 'file') {
        const execution = executeFileCapability({
          callId: call.id,
          args,
          signal: requestController.signal,
          normalizeGeneratedFile,
        });
        if (execution.files?.length) generatedFiles.push(...execution.files);
        results.push(execution.message);
        return { results };
      }
      if (kind === 'artifact') {
        results.push(await executeArtifactCapability({ state, call, args, signal: requestController.signal, imageStoragePath: executionPublicState.settings.imageStoragePath }));
        return { results };
      }
      if (kind === 'skill') {
        results.push(await executeSkillCapability({ state: state as AdapterState & { skillToolCalls: number; skillInstalls: number; generatedArtifactCount: number; usedSkills: Array<{ id: string; name: string }> }, call, args, skillContext, signal: requestController.signal, installer: skillInstaller, parseToolArguments }));
        return { results };
      }
      if (kind === 'canvas') {
        const execution = executeCanvasCapability({
          callId: call.id,
          args,
          signal: requestController.signal,
          canvasDocument,
          parseToolArguments: () => parseToolArguments(call.function?.arguments),
          validateCanvasPatch,
          runId: agentRunId,
        });
        if (execution.canvasPatch) canvasPatch = execution.canvasPatch;
        results.push(execution.message);
        return { results };
      }
      if (kind === 'mcp-manage') return executeMcpManageCapability({
          state,
          call,
          policy,
          args,
          stepCalls,
          callIndex,
          observer,
          requestController,
          agentRunId,
          latestInstruction,
          MCP_MANAGE_LABELS,
          isMcpRuntimeAction,
          runMcpRuntimeAction,
          runMcpManageAction,
          executionPublicState,
          runTabbitBrowserAction,
          mcpToolCallLimit,
          mcpTurnBudgetLimit,
          browserMetrics,
          auditMcpCall,
          mcpServerById,
          browserMutationBatches,
          mcpFilesystemRoots,
          localDataDir,
          persistImageBuffer,
          mcpRepeatTracker,
          agentTurnStartedAt,
          ARTIFACT_MAX_PER_TURN,
          appendPageContext,
          reportProgress,
        });
      if (kind === 'tabbit') return executeTabbitCapability({
          state,
          call,
          policy,
          args,
          stepCalls,
          callIndex,
          observer,
          requestController,
          agentRunId,
          latestInstruction,
          MCP_MANAGE_LABELS,
          isMcpRuntimeAction,
          runMcpRuntimeAction,
          runMcpManageAction,
          executionPublicState,
          runTabbitBrowserAction,
          mcpToolCallLimit,
          mcpTurnBudgetLimit,
          browserMetrics,
          auditMcpCall,
          mcpServerById,
          browserMutationBatches,
          mcpFilesystemRoots,
          localDataDir,
          persistImageBuffer,
          mcpRepeatTracker,
          agentTurnStartedAt,
          ARTIFACT_MAX_PER_TURN,
          appendPageContext,
          reportProgress,
        });
      if (kind === 'mcp') return executeMcpCapability({
          state,
          call,
          policy,
          args,
          stepCalls,
          callIndex,
          observer,
          requestController,
          agentRunId,
          latestInstruction,
          MCP_MANAGE_LABELS,
          isMcpRuntimeAction,
          runMcpRuntimeAction,
          runMcpManageAction,
          executionPublicState,
          runTabbitBrowserAction,
          mcpToolCallLimit,
          mcpTurnBudgetLimit,
          browserMetrics,
          auditMcpCall,
          mcpServerById,
          browserMutationBatches,
          mcpFilesystemRoots,
          localDataDir,
          persistImageBuffer,
          mcpRepeatTracker,
          agentTurnStartedAt,
          ARTIFACT_MAX_PER_TURN,
          appendPageContext,
          reportProgress,
        });
      if (kind === 'image') {
        return executeImageCapability({
          state, call, args, results, observer, latest, requestController, imageToolsAllowed,
          batchPlanContent, isBareImageExecution, extractBatchPrompts, fallbackImagePrompt,
          requestedImageCapability, latestRefs, trackedChatCompletion, agentRuntime,
          requestedAgentImageModelId, imageModels, getRuntimeImageGenerationModel,
          getRuntimeImageModelForCapability, appendGenerationLog, sourceForLog, taskContext,
          startGenerationLog, referenceRecords, getRuntimeImageModelCandidates,
          editImage, generateImage, persistGenerationResult, imageDownloadAuth, finishGenerationLog,
          latestInstruction, agentRunId, executionPublicState,
        });
      }
      Object.assign(state, { webSearchData, webSearchError, generatedFiles, canvasPatch, mcpToolCallCount, mcpTurnBudget, usedMcpTools, browserUses, browserRecoveryNeeded, generated, browserDownloadCount, stalledMcpReason, preparedCaption, batchItems, generations, recentPageText });
      return { results };
    };
}

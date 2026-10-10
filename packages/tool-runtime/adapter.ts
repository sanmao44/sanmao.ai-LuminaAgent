import { executeMcpManageCapability, executeMcpCapability, executeTabbitCapability, type McpCapabilityPorts } from './mcp-capability';
import type { CanvasPatch } from '../contracts/canvas';
import type { ChatMessage } from '../contracts/chat';
import type { SkillCapabilityPorts, SkillContext } from '../contracts/skill';
import type { ToolPolicyDecision } from '../contracts/tool';
import type { ToolRuntimeCall } from './runtime';
import type { RuntimeObserver } from '../contracts/observability';
import type { ToolRuntimeState, ToolCall, GeneratedFile } from './capability-state';
import { executeCanvasCapability, executeFileCapability, executeVideoDownloadCapability, executeWebCapability } from './native-capabilities';
import { executeImageCapability, type ImageCapabilityPorts } from './image-capability';
import { executeSkillCapability } from './skill-capability';
import { executeArtifactCapability, type ArtifactCapabilityInfrastructure } from './artifact-capability';
export interface ToolExecutionAdapterBindings {
  observer?: RuntimeObserver;
  toolExecutionKind(name: unknown, tools: readonly unknown[]): string | null;
  mcpTools: readonly unknown[];
  reportToolProgress(patch: unknown): void;
  agentToolProgress(kind: unknown, name: string): unknown;
  webDecision: { query?: string };
  latest?: { content?: unknown };
  requestController: AbortController;
  searchWeb(query: string, signal: AbortSignal): Promise<unknown>;
  formatWebSearchContext(data: unknown): string;
  normalizeGeneratedFile(raw: unknown, index: number): GeneratedFile | null;
  skillContext: SkillContext;
  skillPorts?: SkillCapabilityPorts;
  skillInstaller: { kind: 'agent'; name: string; detail: string };
  canvasDocument?: unknown;
  parseToolArguments(raw?: string): unknown;
  mcpPorts: McpCapabilityPorts;
  imagePorts: ImageCapabilityPorts;
  artifactInfrastructure: ArtifactCapabilityInfrastructure;
  validateCanvasPatch(document: unknown, patch: CanvasPatch): { ok: true } | { ok: false; error: string; operationIndex?: number };
  agentRunId?: string | null;
  executionPublicState: { settings: { imageStoragePath?: string } };
  videoDownload?: (input: { url: string; outputDirectory: string; format?: 'best' | 'bestvideo+bestaudio/best'; signal: AbortSignal; onProgress?: (line: string) => void }) => Promise<{ filePath: string; bytes: number }>;
  videoStoragePath?: string;
}
export type ToolCallRun = { results: ChatMessage[]; deferred?: true; stalled?: true };
export type ToolExecutionAdapterDependencies = ToolExecutionAdapterBindings & { state: ToolRuntimeState };
export function createToolExecutionAdapter(dependencies: ToolExecutionAdapterDependencies) {
  const { state, observer, toolExecutionKind, mcpTools, reportToolProgress, agentToolProgress, webDecision, latest, requestController, searchWeb, formatWebSearchContext, normalizeGeneratedFile, skillContext, skillPorts, skillInstaller, canvasDocument, parseToolArguments, validateCanvasPatch, imagePorts, mcpPorts, artifactInfrastructure, agentRunId, executionPublicState, videoDownload, videoStoragePath } = dependencies;
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
      if (kind === 'video-download') {
        const execution = await executeVideoDownloadCapability({
          callId: call.id,
          args,
          signal: requestController.signal,
          videoDownload,
          videoStoragePath,
          onProgress: (line) => reportToolProgress(agentToolProgress('video-download', line.slice(0, 160))),
        });
        if (execution.files?.length) generatedFiles.push(...execution.files);
        results.push(execution.message);
        return { results };
      }
      if (kind === 'artifact') {
        results.push(await executeArtifactCapability({ state, call, args, signal: requestController.signal, imageStoragePath: executionPublicState.settings.imageStoragePath, infrastructure: artifactInfrastructure }));
        return { results };
      }
      if (kind === 'skill') {
        results.push(await executeSkillCapability({ state, call, args, skillContext, skillPorts, signal: requestController.signal, installer: skillInstaller, parseToolArguments }));
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
          runId: agentRunId || undefined,
        });
        if (execution.canvasPatch) canvasPatch = execution.canvasPatch;
        results.push(execution.message);
        return { results };
      }
      if (kind === 'mcp-manage') return executeMcpManageCapability({ ...mcpPorts, state, call, policy, args, stepCalls, callIndex });
      if (kind === 'tabbit') return executeTabbitCapability({ ...mcpPorts, state, call, policy, args, stepCalls, callIndex });
      if (kind === 'mcp') return executeMcpCapability({ ...mcpPorts, state, call, policy, args, stepCalls, callIndex });
      if (kind === 'image') {
        return executeImageCapability({
          state, call, args, results, ports: imagePorts,
        });
      }
      Object.assign(state, { webSearchData, webSearchError, generatedFiles, canvasPatch, mcpToolCallCount, mcpTurnBudget, usedMcpTools, browserUses, browserRecoveryNeeded, generated, browserDownloadCount, stalledMcpReason, preparedCaption, batchItems, generations, recentPageText });
      return { results };
    };
}

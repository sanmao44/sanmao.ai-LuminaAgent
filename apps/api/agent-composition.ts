import {
  chatCompletion,
  chatCompletionStream,
  describeProviderFailure,
  editImage,
  generateImage,
  imageDownloadAuth,
  type ChatMessage,
  type ChatContentPart,
} from '@/lib/providers';
import {
  collectArchiveEntries,
  generateArchiveArtifact,
  generateDocumentArtifact,
  generatePresentationArtifact,
  generateSpreadsheetArtifact,
  isValidArtifactId,
  artifactDownloadUrl,
} from '@/lib/artifacts';
import { getStorageRoots, persistImageBuffer } from '@/lib/image-storage';
import {
  getPublicState,
  getRuntimeImageGenerationModel,
  getRuntimeImageModelCandidates,
  getRuntimeImageModelForCapability,
  getRuntimeModel,
  getRuntimeModelCandidates,
} from '@/lib/store';
import { filterModelsByActiveProviders } from '@/lib/provider-availability';
import { getProviderPreset } from '@/lib/provider-presets';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { planSearch, searchWeb, type SearchResponse } from '@/lib/web-search';
import { callMcpTool, MCP_CALL_TIMEOUT_MS, MCP_TOOL_MAX_CALLS_PER_TURN, MCP_TURN_TIME_BUDGET_MS } from '@/lib/mcp/client';
import { MCP_TOOL_SEPARATOR, lazyMcpGroupKeywords, loadMcpToolRuntime, mcpServersForTurn } from '@/lib/mcp/tools';
import { listMcpServers } from '@/lib/mcp/store';
import { BROWSER_EXECUTION_LIMITS, browserExternalBlocker, browserTextNeedsContinuation, browserTextSubmissionGap, type BrowserToolUse } from '@/lib/mcp/browser-guidance';
import { BROWSER_TOOL_GUIDE, TABBIT_BROWSER_TOOL_GUIDE } from '@/lib/mcp/browser-guidance';
import { guardMcpServerCall } from '@/lib/mcp/filesystem-policy';
import { importBrowserArtifacts, shouldImportBrowserArtifacts } from '@/lib/mcp/browser-downloads';
import { noteRemoteCatalogCallFailure, noteRemoteCatalogCallSuccess } from '@/lib/mcp/catalog-remote';
import { listFilesystemRoots, listFilesystemWriteRoots } from '@/lib/mcp/filesystem-roots';
import { recordMcpCall, summarizeMcpAuditText, type McpAuditDecision } from '@/lib/mcp/audit';
import { runMcpManageAction } from '@/lib/mcp/admin';
import { isMcpRuntimeAction, runMcpRuntimeAction } from '@/lib/mcp/runtime-admin';
import { nativeSearchIsEnabled, runNativeWebSearch, stripNativeSearchProcess, type NativeSearchResult } from '@/lib/native-web-search';
import { isTabbitCliAvailable, runTabbitBrowserAction } from '@/lib/tabbit-cli';
import { importLocalImage, isLocalImageRead } from '@/lib/agent/local-image';
import { verifyFilesystemMove } from '@/lib/agent/filesystem-result';
import { stripToolCallMarkup } from '@/lib/skills';
import { discoverMcpForRequest } from '@/lib/mcp/discovery';
import { noteAgentModelFailure, noteAgentModelSuccess, orderAgentModelCandidates } from '@/lib/agent/model-health';
import { resolveLocalDataDir } from '@/lib/data-paths';
import path from 'node:path';
import { BufferedRuntimeObserver, CompositeRuntimeObserver, type RuntimeObserver } from '@/packages/contracts/observability';
import type { SkillCapabilityPorts } from '@/packages/contracts/skill';
import { FileRuntimeObserver } from '@/packages/observability/index';
import { createProviderCoordinator, type ProviderRuntime } from '@/packages/model-runtime/provider-coordinator';
import { createAgentModelInvoker } from '@/packages/model-runtime/agent-invoker';
import {
  buildAgentSkillContext,
  buildSkillToolContent,
  fetchSkillText,
  installSkill,
  installSkillFromDocument,
  parseGithubSkillTarget,
  readSkill,
  readSkillFile,
  recordSkillUsage,
  searchSkills,
  listSkills,
  SKILL_INSTALL_MAX_PER_REQUEST,
  SKILL_TOOL_MAX_CALLS,
  type SkillRecord as LegacySkillRecord,
} from '@/lib/skills';
import { fetchSkillFilesFromGithub } from '@/lib/skill-archive';
import { routeSkillRequest as routeSkillRequestFromMetadata } from '@/packages/agent-core/skill-routing';
import type { SkillRouteDecision, SkillRouteOptions } from '@/packages/contracts/skill';

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

export type AgentChatMessage = ChatMessage;
export type AgentChatContentPart = ChatContentPart;
export type AgentSearchResponse = SearchResponse;
export type AgentNativeSearchResult = NativeSearchResult;
export type AgentBrowserToolUse = BrowserToolUse;
export type AgentMcpAuditDecision = McpAuditDecision;
export const AGENT_BROWSER_EXECUTION_LIMITS = BROWSER_EXECUTION_LIMITS;
export const agentStripNativeSearchProcess = stripNativeSearchProcess;
export type AgentChatPayload = Parameters<typeof chatCompletion>[2];
export type AgentChatProvider = Parameters<typeof chatCompletion>[0];
export type AgentRawModelId = Parameters<typeof chatCompletion>[1];
export type AgentChatResponse = Awaited<ReturnType<typeof chatCompletion>>;
export type AgentChatStreamResponse = Awaited<ReturnType<typeof chatCompletionStream>>;
export type AgentMcpDiscovery = typeof discoverMcpForRequest;

/** Concrete infrastructure is assembled here and injected into the application. */
export type AgentApplicationInfrastructure = {
  provider: {
    chatCompletion: typeof chatCompletion;
    chatCompletionStream: typeof chatCompletionStream;
    describeProviderFailure: typeof describeProviderFailure;
    editImage: typeof editImage;
    generateImage: typeof generateImage;
    imageDownloadAuth: typeof imageDownloadAuth;
  };
  artifacts: {
    collectArchiveEntries: typeof collectArchiveEntries;
    generateArchiveArtifact: typeof generateArchiveArtifact;
    generateDocumentArtifact: typeof generateDocumentArtifact;
    generatePresentationArtifact: typeof generatePresentationArtifact;
    generateSpreadsheetArtifact: typeof generateSpreadsheetArtifact;
    isValidArtifactId: typeof isValidArtifactId;
    artifactDownloadUrl: typeof artifactDownloadUrl;
    getStorageRoots: typeof getStorageRoots;
  };
  models: {
    getPublicState: typeof getPublicState;
    getRuntimeImageGenerationModel: typeof getRuntimeImageGenerationModel;
    getRuntimeImageModelCandidates: typeof getRuntimeImageModelCandidates;
    getRuntimeImageModelForCapability: typeof getRuntimeImageModelForCapability;
    getRuntimeModel: typeof getRuntimeModel;
    getRuntimeModelCandidates: typeof getRuntimeModelCandidates;
    filterModelsByActiveProviders: typeof filterModelsByActiveProviders;
    getProviderPreset: typeof getProviderPreset;
  };
  persistence: {
    appendGenerationLog: typeof appendGenerationLog;
    finishGenerationLog: typeof finishGenerationLog;
    startGenerationLog: typeof startGenerationLog;
    persistGenerationResult: typeof persistGenerationResult;
  };
  web: { planSearch: typeof planSearch; searchWeb: typeof searchWeb };
  mcp: {
    callMcpTool: typeof callMcpTool;
    MCP_CALL_TIMEOUT_MS: typeof MCP_CALL_TIMEOUT_MS;
    MCP_TOOL_MAX_CALLS_PER_TURN: typeof MCP_TOOL_MAX_CALLS_PER_TURN;
    MCP_TURN_TIME_BUDGET_MS: typeof MCP_TURN_TIME_BUDGET_MS;
    MCP_TOOL_SEPARATOR: typeof MCP_TOOL_SEPARATOR;
    lazyMcpGroupKeywords: typeof lazyMcpGroupKeywords;
    loadMcpToolRuntime: typeof loadMcpToolRuntime;
    mcpServersForTurn: typeof mcpServersForTurn;
    listMcpServers: typeof listMcpServers;
    BROWSER_TOOL_GUIDE: typeof BROWSER_TOOL_GUIDE;
    TABBIT_BROWSER_TOOL_GUIDE: typeof TABBIT_BROWSER_TOOL_GUIDE;
    BROWSER_EXECUTION_LIMITS: typeof BROWSER_EXECUTION_LIMITS;
    browserExternalBlocker: typeof browserExternalBlocker;
    browserTextNeedsContinuation: typeof browserTextNeedsContinuation;
    browserTextSubmissionGap: typeof browserTextSubmissionGap;
    guardMcpServerCall: typeof guardMcpServerCall;
    importBrowserArtifacts: typeof importBrowserArtifacts;
    shouldImportBrowserArtifacts: typeof shouldImportBrowserArtifacts;
    noteRemoteCatalogCallFailure: typeof noteRemoteCatalogCallFailure;
    noteRemoteCatalogCallSuccess: typeof noteRemoteCatalogCallSuccess;
    listFilesystemRoots: typeof listFilesystemRoots;
    listFilesystemWriteRoots: typeof listFilesystemWriteRoots;
    recordMcpCall: typeof recordMcpCall;
    summarizeMcpAuditText: typeof summarizeMcpAuditText;
    runMcpManageAction: typeof runMcpManageAction;
    isMcpRuntimeAction: typeof isMcpRuntimeAction;
    runMcpRuntimeAction: typeof runMcpRuntimeAction;
    discoverMcpForRequest: typeof discoverMcpForRequest;
  };
  browser: { isTabbitCliAvailable: typeof isTabbitCliAvailable; runTabbitBrowserAction: typeof runTabbitBrowserAction };
  filesystem: { persistImageBuffer: typeof persistImageBuffer; importLocalImage: typeof importLocalImage; isLocalImageRead: typeof isLocalImageRead; verifyFilesystemMove: typeof verifyFilesystemMove };
  skills: {
    buildAgentSkillContext: typeof buildAgentSkillContext;
    routeSkillRequest: (input: string, options?: { dataDir?: string; explicitSkillId?: string }) => SkillRouteDecision;
    createCapabilityPorts: (dataDir?: string) => SkillCapabilityPorts;
    SKILL_TOOL_MAX_CALLS: typeof SKILL_TOOL_MAX_CALLS;
    stripToolCallMarkup: typeof stripToolCallMarkup;
  };
  search: { nativeSearchIsEnabled: typeof nativeSearchIsEnabled; runNativeWebSearch: typeof runNativeWebSearch; stripNativeSearchProcess: typeof stripNativeSearchProcess };
  data: { resolveLocalDataDir: typeof resolveLocalDataDir };
  health: { orderAgentModelCandidates: typeof orderAgentModelCandidates; noteAgentModelSuccess: typeof noteAgentModelSuccess; noteAgentModelFailure: typeof noteAgentModelFailure };
};

export function createAgentApplicationInfrastructure(): AgentApplicationInfrastructure {
  const routeSkillRequest = (input: string, options: { dataDir?: string; explicitSkillId?: string } = {}) => {
    const routeOptions: SkillRouteOptions = options.explicitSkillId ? { explicitSkillId: options.explicitSkillId } : {};
    return routeSkillRequestFromMetadata(input, listSkills({ dataDir: options.dataDir, pending: false }), routeOptions);
  };
  const createSkillCapabilityPorts = (dataDir?: string): SkillCapabilityPorts => ({
    maxCalls: SKILL_TOOL_MAX_CALLS,
    maxInstalls: SKILL_INSTALL_MAX_PER_REQUEST,
    searchSkills: (query, skills, limit) => searchSkills(query, skills.map((skill) => skill as LegacySkillRecord), limit),
    readSkill: (id, options) => readSkill(id, { ...options, dataDir }),
    readSkillFile: (id, filePath, options) => readSkillFile(id, filePath, { ...options, dataDir }),
    recordSkillUsage: (id, options) => { recordSkillUsage(id, { ...options, dataDir }); },
    buildSkillToolContent: (skill, file, offset) => buildSkillToolContent(skill as LegacySkillRecord, file, offset),
    installSkill: (input) => installSkill(input as Parameters<typeof installSkill>[0], { dataDir }),
    installSkillFromDocument: (input) => installSkillFromDocument(input as Parameters<typeof installSkillFromDocument>[0], { dataDir }),
    fetchSkillText: (source, options) => fetchSkillText(source, options),
    parseGithubSkillTarget: (source) => parseGithubSkillTarget(source),
    fetchSkillFilesFromGithub: (target, options) => fetchSkillFilesFromGithub({ ...target, ref: target.ref || '', dir: target.dir || '' }, options),
  });
  return {
    provider: { chatCompletion, chatCompletionStream, describeProviderFailure, editImage, generateImage, imageDownloadAuth },
    artifacts: { collectArchiveEntries, generateArchiveArtifact, generateDocumentArtifact, generatePresentationArtifact, generateSpreadsheetArtifact, isValidArtifactId, artifactDownloadUrl, getStorageRoots },
    models: { getPublicState, getRuntimeImageGenerationModel, getRuntimeImageModelCandidates, getRuntimeImageModelForCapability, getRuntimeModel, getRuntimeModelCandidates, filterModelsByActiveProviders, getProviderPreset },
    persistence: { appendGenerationLog, finishGenerationLog, startGenerationLog, persistGenerationResult },
    web: { planSearch, searchWeb },
    mcp: { callMcpTool, MCP_CALL_TIMEOUT_MS, MCP_TOOL_MAX_CALLS_PER_TURN, MCP_TURN_TIME_BUDGET_MS, MCP_TOOL_SEPARATOR, lazyMcpGroupKeywords, loadMcpToolRuntime, mcpServersForTurn, listMcpServers, BROWSER_TOOL_GUIDE, TABBIT_BROWSER_TOOL_GUIDE, BROWSER_EXECUTION_LIMITS, browserExternalBlocker, browserTextNeedsContinuation, browserTextSubmissionGap, guardMcpServerCall, importBrowserArtifacts, shouldImportBrowserArtifacts, noteRemoteCatalogCallFailure, noteRemoteCatalogCallSuccess, listFilesystemRoots, listFilesystemWriteRoots, recordMcpCall, summarizeMcpAuditText, runMcpManageAction, isMcpRuntimeAction, runMcpRuntimeAction, discoverMcpForRequest },
    browser: { isTabbitCliAvailable, runTabbitBrowserAction },
    filesystem: { persistImageBuffer, importLocalImage, isLocalImageRead, verifyFilesystemMove },
    skills: { buildAgentSkillContext, routeSkillRequest, createCapabilityPorts: createSkillCapabilityPorts, SKILL_TOOL_MAX_CALLS, stripToolCallMarkup },
    search: { nativeSearchIsEnabled, runNativeWebSearch, stripNativeSearchProcess },
    data: { resolveLocalDataDir },
    health: { orderAgentModelCandidates, noteAgentModelSuccess, noteAgentModelFailure },
  };
}

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
  infrastructure?: AgentApplicationInfrastructure;
};

export type AgentApplicationComposition<TRuntime extends AgentCompositionRuntime> = {
  observer: RuntimeObserver;
  infrastructure: AgentApplicationInfrastructure;
  invokeChatModel: (payload: ChatPayload, signal?: AbortSignal) => Promise<ChatResponse>;
  invokeChatModelStream: (payload: ChatPayload, signal?: AbortSignal) => Promise<StreamResponse>;
  invokeSpecificChatModel: (runtime: TRuntime, payload: ChatPayload, signal: AbortSignal) => Promise<ChatResponse>;
  invokeCandidateChatModels: (candidates: readonly TRuntime[], payload: ChatPayload, signal: AbortSignal) => Promise<ChatResponse>;
};

/**
 * Composition root for the Agent application. Concrete provider transports,
 * health persistence callbacks and operational observers are assembled here;
 * the application execution path only consumes the returned model ports.
 */
export function createAgentApplicationComposition<TRuntime extends AgentCompositionRuntime>(
  options: AgentApplicationCompositionOptions<TRuntime>,
): AgentApplicationComposition<TRuntime> {
  const infrastructure = options.infrastructure || createAgentApplicationInfrastructure();
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
    infrastructure,
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
    invokeCandidateChatModels: (candidates, payload, signal) => invoker.invokeCandidates(candidates, payload, signal),
  };
}

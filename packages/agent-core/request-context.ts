import type { GenerationSource, WorkspaceContext } from '../contracts/context';

type CanvasDocument = unknown;

export type AgentRequestContextInput = {
  body: Record<string, unknown>;
  runId?: string | null;
  normalizeWorkspaceContext: (value: unknown) => WorkspaceContext;
  normalizeDocument: (value: unknown) => CanvasDocument;
  normalizeGenerationSource: (value: unknown, fallback: GenerationSource) => GenerationSource;
};

/** Transport-neutral request context preparation used by the Agent application entry. */
export function prepareAgentRequestContext(input: AgentRequestContextInput) {
  const body = input.body;
  const workspaceContext = body.context && typeof body.context === 'object' ? input.normalizeWorkspaceContext(body.context) : null;
  const canvasDocument = body.canvasDocument && typeof body.canvasDocument === 'object' ? input.normalizeDocument(body.canvasDocument) : null;
  const canvasTarget = body.canvasTarget && typeof body.canvasTarget === 'object' ? body.canvasTarget as { nodeIds?: unknown; kind?: unknown; operation?: unknown } : null;
  const canvasTargetNodeIds = Array.isArray(canvasTarget?.nodeIds)
    ? [...new Set(canvasTarget.nodeIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 64)
    : workspaceContext?.selectedNodeIds || [];
  const canvasTargetKind = ['none', 'text', 'image', 'video', 'mixed'].includes(String(canvasTarget?.kind)) ? String(canvasTarget?.kind) : 'none';
  const canvasTargetOperation = canvasTarget?.operation === 'edit' ? 'edit' : 'generate';
  const sourceForLog = input.normalizeGenerationSource(body.source, 'agent');
  const isCanvasSource = sourceForLog === 'canvas';
  const isCanvasNodeExecution = isCanvasSource && body.executionMode !== 'agent-dock';
  const taskContext = {
    ...(workspaceContext ? {
      projectId: workspaceContext.creativeProjectId,
      chatId: workspaceContext.chatId,
      canvasId: workspaceContext.canvasId,
      ...(workspaceContext.selectedNodeIds[0] ? { nodeId: workspaceContext.selectedNodeIds[0] } : {}),
    } : {}),
    ...(input.runId ? { taskId: input.runId } : {}),
  };
  return { workspaceContext, canvasDocument, canvasTargetNodeIds, canvasTargetKind, canvasTargetOperation, sourceForLog, isCanvasSource, isCanvasNodeExecution, taskContext };
}

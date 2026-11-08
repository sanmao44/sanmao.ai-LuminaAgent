import { addEdge, createMedia, nodeById, nodeSize } from './model';
import type { CanvasDocument, CanvasNode, CanvasNodeParams } from './types';
import type { GenerationLog } from '@/lib/generation-log';
import { displayGenerationLogStatus } from './activity-log';

export function canvasNodeHasTask(node: CanvasNode | undefined, taskId: string) {
  return Boolean(node && taskId && String(node.data.jobId || node.data.generation?.taskId || '') === taskId);
}

/** A provider receipt timeout is still waiting for confirmation, not a failed generation. */
export function canvasGenerationLogRecoveryStatus(log: { status?: string; errorCode?: string }) {
  return displayGenerationLogStatus(log);
}

export function canvasNodeForGenerationLog(document: CanvasDocument, log: Pick<GenerationLog, 'id' | 'taskId' | 'nodeId' | 'prompt' | 'mode' | 'mediaKind'>) {
  const taskId = String(log.taskId || log.id || '');
  const taskNode = document.nodes.find((node) => canvasNodeHasTask(node, taskId));
  if (taskNode) return taskNode;

  const variantNode = document.nodes.find((node) =>
    node.type === 'generator' && node.data.variantStates?.some((state) =>
      state.taskIds?.some((id) => String(id) === taskId),
    ),
  );
  if (variantNode) return variantNode;

  const expectedKind = log.mediaKind || (log.mode === 'video' ? 'video' : log.mode === 'audio' ? 'audio' : 'image');
  const linkedNode = log.nodeId ? nodeById(document, log.nodeId) : undefined;
  if (linkedNode && (linkedNode.data.kind || 'image') === expectedKind) return linkedNode;

  return document.nodes.find((node) =>
    node.data.generation?.prompt === log.prompt && (node.data.kind || 'image') === expectedKind,
  );
}

/** Merge HTTP and recovery results by task/url while keeping existing node identities. */
export function mergeCanvasTaskImages(document: CanvasDocument, nodeId: string, taskId: string, outputs: CanvasNode[]) {
  const target = nodeById(document, nodeId);
  if (!canvasNodeHasTask(target, taskId) || !outputs.length) return document;
  const fillsTarget = target!.type === 'media';
  const uniqueOutputs = [...new Map(outputs.filter((output) => output.data.url)
    .map((output) => [output.data.url!, output])).values()];
  if (!uniqueOutputs.length) return document;
  // A partial or reordered response must not replace an already recovered image.
  const targetOutput = fillsTarget && target!.data.url && target!.data.generation?.taskId === taskId
    ? uniqueOutputs.find((output) => output.data.url === target!.data.url)
    : fillsTarget ? uniqueOutputs[0] : undefined;
  const existing = new Map(document.nodes.filter((node) => node.data.generation?.taskId === taskId && node.data.url)
    .map((node) => [node.data.url!, node]));
  if (targetOutput) existing.set(targetOutput.data.url!, target!);
  const additions: CanvasNode[] = [];
  for (const output of uniqueOutputs) {
    const url = output.data.url;
    if (!url || existing.has(url)) continue;
    existing.set(url, output);
    additions.push(output);
  }
  let next: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) => {
      const output = fillsTarget && node.id === nodeId ? targetOutput
        : uniqueOutputs.find((candidate) => candidate.data.url === node.data.url && node.data.generation?.taskId === taskId);
      return output ? { ...node, data: { ...node.data, ...output.data, status: 'completed' as const, statusLabel: '图片已完成', progress: 100, processingStartedAt: undefined } } : node;
    }).concat(additions),
  };
  additions.forEach((node) => { next = addEdge(next, nodeId, node.id, 'right', 'left', fillsTarget ? 'variant' : 'generated'); });
  return next;
}

/** Project a read-only Worker snapshot onto its existing upscale node. */
export function recoverCanvasUpscaleTask(document: CanvasDocument, input: {
  nodeId: string;
  taskId: string;
  requestId: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  imageUrl?: string;
  modelName?: string;
  error?: string;
}) {
  const current = nodeById(document, input.nodeId);
  if (current?.type !== 'upscale'
    || String(current.data.jobId || '') !== input.taskId
    || String(current.data.upscaleRequestId || '') !== input.requestId) return document;

  const imageUrl = String(input.imageUrl || '').trim();
  if (imageUrl) {
    if (current.data.url === imageUrl && current.data.status === 'completed') return document;
    return {
      ...document,
      nodes: document.nodes.map((node) => node.id === current.id ? {
        ...node,
        data: {
          ...node.data,
          kind: 'image' as const,
          url: imageUrl,
          role: '超分结果',
          resultSource: 'upscale-node' as const,
          ...(input.modelName ? { model: input.modelName } : {}),
          status: 'completed' as const,
          statusLabel: '超分节点生成的结果',
          progress: 100,
          processingStartedAt: undefined,
          generation: node.data.generation ? {
            ...node.data.generation,
            taskId: input.requestId,
            updatedAt: Date.now(),
          } : node.data.generation,
        },
      } : node),
    };
  }

  if (input.status === 'queued' || input.status === 'processing' || input.status === 'succeeded') return document;
  const error = String(input.error || (input.status === 'cancelled' ? '超分任务已取消' : '超分处理失败'));
  if (current.data.status === 'failed' && current.data.statusLabel === error) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === current.id ? {
      ...node,
      data: {
        ...node.data,
        status: 'failed' as const,
        statusLabel: error,
        progress: undefined,
        processingStartedAt: undefined,
      },
    } : node),
  };
}

/** A document operation; callers apply it through CanvasCore, without owning task lifecycle. */
export function recoverCanvasTask(document: CanvasDocument, input: {
  nodeId: string;
  taskId: string;
  status: string | undefined;
  urls: string[];
  error?: string;
  imageParams: CanvasNodeParams;
}) {
  const current = nodeById(document, input.nodeId);
  if (!canvasNodeHasTask(current, input.taskId)) return document;
  const node = current!;
  if (input.status !== 'success') {
    if (node.data.url || node.data.status === 'completed' || !input.status || !['pending', 'error'].includes(input.status)) return document;
    return { ...document, nodes: document.nodes.map((item) => item.id === node.id
      ? { ...item, data: { ...item.data, status: input.status === 'error' ? 'failed' as const : 'running' as const,
        ...(input.status === 'error' ? { progress: undefined, processingStartedAt: undefined } : {}),
        statusLabel: input.status === 'error' ? input.error || '生成失败' : '服务商仍在生成，请稍候' } } : item) };
  }
  const urls = [...new Set(input.urls.filter(Boolean))];
  if (node.data.kind === 'video') {
    if (!urls[0]) return document;
    return { ...document, nodes: document.nodes.map((item) => item.id === node.id
      ? { ...item, data: { ...item.data, url: urls[0], status: 'completed' as const, statusLabel: '视频已完成', progress: 100, processingStartedAt: undefined } } : item) };
  }
  const outputs = urls.map((url, index) => createMedia('image', url, `生成图片 ${index + 1}`, {
    x: node.x + (node.type === 'media' ? 0 : nodeSize(node).w + 90) + (index % 2) * 400,
    y: node.y + Math.floor(index / 2) * 300,
  }, {
    role: node.type === 'prompt' ? 'Agent 生成结果' : '生成结果',
    generation: node.data.generation ? { ...node.data.generation, taskId: input.taskId } : {
      kind: 'image', prompt: String(node.data.agentPrompt || node.data.prompt || node.data.text || ''),
      params: node.data.params || input.imageParams, parentNodeId: node.id, taskId: input.taskId, createdAt: Date.now(),
    },
  }));
  const next = mergeCanvasTaskImages(document, node.id, input.taskId, outputs);
  if (node.type !== 'prompt') return next;
  return { ...next, nodes: next.nodes.map((item) => item.id === node.id
    ? { ...item, data: { ...item.data, status: 'completed' as const, statusLabel: 'Agent 已回复', processingStartedAt: undefined } } : item) };
}

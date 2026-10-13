import { addEdge, createMedia, nodeById, nodeSize } from './model';
import type { CanvasDocument, CanvasNode, CanvasNodeParams } from './types';

export function canvasNodeHasTask(node: CanvasNode | undefined, taskId: string) {
  return Boolean(node && taskId && String(node.data.jobId || node.data.generation?.taskId || '') === taskId);
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

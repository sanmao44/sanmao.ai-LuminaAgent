import type { CanvasDocument, CanvasNode } from './types';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function checkpointFingerprint(value: string) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(36);
}

export function agentCheckpointTriggerId(
  runId: string | undefined,
  canvasId: string,
  action: string,
  document: CanvasDocument,
) {
  const state = {
    nodes: document.nodes,
    edges: document.edges,
    groups: document.groups,
    camera: document.camera,
  };
  return `agent_${checkpointFingerprint(JSON.stringify([runId?.trim() || '', canvasId, action, state]))}`;
}

function generatedTaskId(node: CanvasNode) {
  if (node.type !== 'media' && node.type !== 'upscale') return '';
  if (node.data.kind !== 'image' && node.data.kind !== 'video') return '';
  const taskId = node.data.generation?.taskId;
  return typeof taskId === 'string' ? taskId.trim() : '';
}

function isActiveStatus(status: CanvasNode['data']['status']) {
  return status === 'queued' || status === 'running';
}

export function completedGeneratedTaskIds(previous: CanvasDocument, next: CanvasDocument) {
  const nextById = new Map(next.nodes.map((node) => [node.id, node]));
  const completedTaskIds = new Set<string>();

  for (const previousNode of previous.nodes) {
    const nextNode = nextById.get(previousNode.id);
    if (!nextNode || nextNode.data.status !== 'completed') continue;

    if (previousNode.type === 'prompt' && previousNode.data.status === 'running' && nextNode.type === 'prompt') {
      const runId = String(nextNode.data.jobId || '').trim();
      const response = String(nextNode.data.agentResponse || nextNode.data.text || '').trim();
      if (runId && response) completedTaskIds.add(`agent_${runId}`);
      continue;
    }

    if (!isActiveStatus(previousNode.data.status) || !String(nextNode.data.url || '').trim()) continue;
    const taskId = generatedTaskId(nextNode);
    if (taskId) completedTaskIds.add(taskId);
  }

  return [...completedTaskIds];
}

export function speechCheckpointTriggerId(nodeId: string, createdAt: number) {
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId || !Number.isFinite(createdAt) || createdAt <= 0) return '';
  return `speech_${normalizedNodeId}_${Math.floor(createdAt)}`;
}

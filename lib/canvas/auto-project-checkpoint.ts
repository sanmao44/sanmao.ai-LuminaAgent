import type { CanvasDocument, CanvasNode } from './types';

export type AutoProjectCheckpointIntervalMinutes = 0 | 1 | 5 | 15;

export const DEFAULT_AUTO_PROJECT_CHECKPOINT_INTERVAL_MINUTES: AutoProjectCheckpointIntervalMinutes = 0;

export const AUTO_PROJECT_CHECKPOINT_INTERVAL_OPTIONS: Array<{
  value: AutoProjectCheckpointIntervalMinutes;
  label: string;
  description: string;
}> = [
  { value: 0, label: '每次生成', description: '每次生成完成后保存版本快照' },
  { value: 1, label: '1 分钟', description: '间隔内完成的生成合并为一个版本快照' },
  { value: 5, label: '5 分钟', description: '间隔内完成的生成合并为一个版本快照' },
  { value: 15, label: '15 分钟', description: '间隔内完成的生成合并为一个版本快照' },
];

export function normalizeAutoProjectCheckpointIntervalMinutes(value: unknown): AutoProjectCheckpointIntervalMinutes {
  return value === 1 || value === 5 || value === 15
    ? value
    : DEFAULT_AUTO_PROJECT_CHECKPOINT_INTERVAL_MINUTES;
}

export function automaticProjectCheckpointDelay(
  versions: readonly { id: string; canvasId: string; createdAt: number }[],
  canvasId: string,
  intervalMinutes: AutoProjectCheckpointIntervalMinutes,
  now: number,
) {
  if (intervalMinutes === 0) return 0;

  let latestCheckpointAt: number | null = null;
  for (const version of versions) {
    if (version.canvasId !== canvasId || !version.id.startsWith('auto_') || !Number.isFinite(version.createdAt)) continue;
    latestCheckpointAt = Math.max(latestCheckpointAt ?? version.createdAt, version.createdAt);
  }

  if (latestCheckpointAt === null) return 0;
  return Math.max(0, latestCheckpointAt + intervalMinutes * 60_000 - now);
}

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

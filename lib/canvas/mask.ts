import type { CanvasDocument, CanvasMaskState, CanvasMaskStatus } from './types';
import { normalizeLocalEditAnnotations } from '../local-edit';

const MASK_STATUSES: CanvasMaskStatus[] = ['pending', 'running', 'used', 'failed'];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

/** Normalize persisted mask metadata and fall back to legacy params.mask. */
export function normalizeCanvasMaskState(value: unknown, fallback?: unknown): CanvasMaskState | undefined {
  const raw = objectValue(value);
  const fallbackRaw = objectValue(fallback);
  const url = typeof raw.url === 'string' && raw.url
    ? raw.url
    : typeof fallbackRaw.url === 'string' && fallbackRaw.url
      ? fallbackRaw.url
      : '';
  if (!url) return undefined;
  const status = MASK_STATUSES.includes(raw.status as CanvasMaskStatus)
    ? raw.status as CanvasMaskStatus
    : 'pending';
  const coverage = finiteNumber(raw.coverage ?? fallbackRaw.coverage);
  const annotations = normalizeLocalEditAnnotations(raw.annotations ?? fallbackRaw.annotations);
  return {
    url,
    ...(typeof (raw.assetId ?? fallbackRaw.assetId) === 'string'
      ? { assetId: String(raw.assetId ?? fallbackRaw.assetId) }
      : {}),
    ...(typeof (raw.sourceAssetId ?? fallbackRaw.sourceAssetId) === 'string'
      ? { sourceAssetId: String(raw.sourceAssetId ?? fallbackRaw.sourceAssetId) }
      : {}),
    ...(typeof (raw.sourceUrl ?? fallbackRaw.sourceUrl) === 'string'
      ? { sourceUrl: String(raw.sourceUrl ?? fallbackRaw.sourceUrl) }
      : {}),
    status,
    ...(coverage !== undefined ? { coverage: Math.max(0, Math.min(1, coverage)) } : {}),
    ...(annotations.length ? { annotations } : {}),
    ...(typeof raw.taskId === 'string' ? { taskId: raw.taskId } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    ...(finiteNumber(raw.createdAt) !== undefined ? { createdAt: finiteNumber(raw.createdAt) } : {}),
    ...(finiteNumber(raw.updatedAt) !== undefined ? { updatedAt: finiteNumber(raw.updatedAt) } : {}),
  };
}

export function canvasMaskStateFromParams(
  params: unknown,
  status: CanvasMaskStatus = 'pending',
  extra: Partial<CanvasMaskState> = {},
) {
  const mask = objectValue(objectValue(params).mask);
  if (typeof mask.url !== 'string' || !mask.url) return undefined;
  return normalizeCanvasMaskState({ ...mask, ...extra, status }, mask);
}

export function canvasMaskStatusLabel(status: CanvasMaskStatus) {
  return status === 'running'
    ? '生成中'
    : status === 'used'
      ? '已使用'
      : status === 'failed'
        ? '生成失败'
        : '待生成';
}

export function updateCanvasMaskState(
  document: CanvasDocument,
  nodeId: string,
  patch: Partial<CanvasMaskState> & { status: CanvasMaskStatus },
) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'image') return node;
      const generationParams = node.data.generation?.params;
      const paramsMask =
        node.data.params && typeof node.data.params === 'object'
          ? (node.data.params as Record<string, unknown>).mask
          : undefined;
      const generationMask =
        generationParams && typeof generationParams === 'object'
          ? (generationParams as Record<string, unknown>).mask
          : undefined;
      const current = normalizeCanvasMaskState(
        node.data.mask,
        generationMask || paramsMask,
      );
      if (!current) return node;
      return {
        ...node,
        data: {
          ...node.data,
          mask: {
            ...current,
            ...patch,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  };
}

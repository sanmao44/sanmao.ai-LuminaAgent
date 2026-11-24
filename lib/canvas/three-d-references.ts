import type { Cangyuan3DOptions, Cangyuan3DView } from '@/packages/contracts/cangyuan-media';
import type { CanvasNode, CanvasThreeDDraft } from './types';
import { isCanvasReadyImageSource } from './model';

export const CANVAS_THREE_D_VIEWS = ['front', 'back', 'left', 'right'] as const;
export type CanvasThreeDReferenceSlot = 'image' | Cangyuan3DView;
export type CanvasThreeDReference = { url: string; name: string; nodeId?: string };

/** Resolve connected nodes at read time, so replacement and disconnection never leave stale URLs. */
export function resolveCanvasThreeDReferences(draft: CanvasThreeDDraft, nodes: readonly CanvasNode[]) {
  const available = nodes.filter(isCanvasReadyImageSource).map((node) => ({
    nodeId: node.id, url: String(node.data.url || ''), name: String(node.data.name || '画布图片'),
  })).filter((item) => Boolean(item.url));
  const used = new Set<string>();
  const multiview: Partial<Record<Cangyuan3DView, CanvasThreeDReference>> = {};
  const explicit = (slot: CanvasThreeDReferenceSlot): CanvasThreeDReference | undefined => {
    const nodeId = draft.referenceNodes?.[slot];
    if (typeof nodeId === 'string') return available.find((item) => item.nodeId === nodeId);
    const url = slot === 'image' ? draft.options.imageUrl : draft.options.multiviewImages?.[slot];
    return url ? { url, name: '已添加图片' } : undefined;
  };
  for (const view of CANVAS_THREE_D_VIEWS) {
    const reference = explicit(view);
    if (reference && !used.has(reference.url)) { multiview[view] = reference; used.add(reference.url); }
  }
  for (const view of CANVAS_THREE_D_VIEWS) {
    if (multiview[view] || draft.options.multiviewImages?.[view] || draft.referenceNodes && view in draft.referenceNodes) continue;
    const reference = available.find((item) => !used.has(item.url));
    if (reference) { multiview[view] = reference; used.add(reference.url); }
  }
  const image = explicit('image') || (draft.referenceNodes && 'image' in draft.referenceNodes ? undefined : available[0]);
  return { image, multiview, available };
}

export function canvasThreeDReferenceOptions(draft: CanvasThreeDDraft, nodes: readonly CanvasNode[]): Cangyuan3DOptions {
  const resolved = resolveCanvasThreeDReferences(draft, nodes);
  return {
    ...draft.options,
    imageUrl: resolved.image?.url,
    multiviewImages: Object.fromEntries(CANVAS_THREE_D_VIEWS.flatMap((view) =>
      resolved.multiview[view] ? [[view, resolved.multiview[view]!.url]] : [],
    )),
  };
}

/** Materialize assignments before swapping, including automatic incoming references. */
export function assignCanvasThreeDReference(
  draft: CanvasThreeDDraft,
  nodes: readonly CanvasNode[],
  slot: CanvasThreeDReferenceSlot,
  reference?: CanvasThreeDReference,
): CanvasThreeDDraft {
  const resolved = resolveCanvasThreeDReferences(draft, nodes);
  const next: CanvasThreeDDraft = {
    ...draft,
    referenceNodes: { ...draft.referenceNodes },
    options: { ...draft.options, multiviewImages: { ...draft.options.multiviewImages } },
  };
  const write = (target: CanvasThreeDReferenceSlot, item?: CanvasThreeDReference) => {
    next.referenceNodes![target] = item?.nodeId || null;
    if (target === 'image') next.options.imageUrl = item?.nodeId ? undefined : item?.url;
    else if (item?.url && !item.nodeId) next.options.multiviewImages![target] = item.url;
    else delete next.options.multiviewImages![target];
  };
  if (slot === 'image') { write(slot, reference); return next; }
  for (const view of CANVAS_THREE_D_VIEWS) {
    if (resolved.multiview[view]) write(view, resolved.multiview[view]);
  }
  const previous = resolved.multiview[slot];
  const occupied = CANVAS_THREE_D_VIEWS.find((view) => view !== slot && reference && resolved.multiview[view]?.url === reference.url);
  if (occupied) write(occupied, previous);
  write(slot, reference);
  return next;
}

export function swapCanvasThreeDViews(draft: CanvasThreeDDraft, nodes: readonly CanvasNode[], from: Cangyuan3DView, to: Cangyuan3DView) {
  const resolved = resolveCanvasThreeDReferences(draft, nodes);
  const next = assignCanvasThreeDReference(draft, nodes, from, resolved.multiview[to]);
  return assignCanvasThreeDReference(next, nodes, to, resolved.multiview[from]);
}

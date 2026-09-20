import type { GalleryItem } from "@/lib/client-history";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { ProvenanceEdge, ProvenanceEdgeDraft, ProvenanceRelation } from "./types";

function edgeId(fromId: string, toId: string, relation: ProvenanceRelation) {
  return `provenance:${relation}:${fromId}:${toId}`;
}

export function createProvenanceEdge(draft: ProvenanceEdgeDraft & { toId: string }): ProvenanceEdge {
  return { ...draft, id: edgeId(draft.fromId, draft.toId, draft.relation) };
}

export function provenanceDraftsForSources(
  sourceIds: readonly string[],
  relation: ProvenanceRelation,
  context: { taskId?: string; projectId?: string; chatId?: string; canvasId?: string; nodeId?: string } = {},
): ProvenanceEdgeDraft[] {
  return [...new Set(sourceIds.map((id) => String(id || "").trim()).filter(Boolean))].map((fromId) => ({
    fromId,
    relation,
    ...(context.taskId ? { taskId: context.taskId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.chatId ? { chatId: context.chatId } : {}),
    ...(context.canvasId ? { canvasId: context.canvasId } : {}),
    ...(context.nodeId ? { nodeId: context.nodeId } : {}),
  }));
}

export function provenanceEdgesForGalleryItem(item: GalleryItem) {
  return Array.isArray(item.provenance) ? item.provenance : [];
}

export function normalizeCanvasProvenance(document: CanvasDocument) {
  const edges: ProvenanceEdge[] = [];
  for (const node of document.nodes) {
    const generation = node.data.generation;
    if (!generation?.provenance?.length) continue;
    for (const edge of generation.provenance) {
      if (!edge.fromId || !edge.toId || !edge.relation) continue;
      edges.push(createProvenanceEdge(edge));
    }
  }
  return edges;
}

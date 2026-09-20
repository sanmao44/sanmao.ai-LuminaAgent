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

export type CanvasLineageRecord = {
  resultNodeId: string;
  sourceNodeIds: string[];
  edges: ProvenanceEdge[];
};

function fallbackRelationForNode(node: CanvasDocument["nodes"][number]): ProvenanceRelation {
  const generation = node.data.generation;
  if (generation?.operation === "edit") return "edited_from";
  if (generation?.operation === "upscale") return "upscaled_from";
  if (generation?.kind === "video" && generation.sourceImageNodeId) return "converted_to_video";
  return "derived_from";
}

/**
 * Finds persisted canvas results for one task and normalizes their source links.
 * The fallback fields keep older documents inspectable without a migration.
 */
export function canvasLineageForTask(document: CanvasDocument, taskId: string): CanvasLineageRecord[] {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return [];
  const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
  return document.nodes
    .filter((node) => node.data.generation?.taskId === normalizedTaskId)
    .map((node) => {
      const generation = node.data.generation;
      const persistedEdges = (generation?.provenance || [])
        .filter((edge) => edge.fromId && edge.toId === node.id)
        .map((edge) => createProvenanceEdge({ ...edge, toId: node.id }));
      const candidateSourceIds = [
        ...persistedEdges.map((edge) => edge.fromId),
        ...(generation?.referenceIds || []),
        ...(generation?.parentNodeId ? [generation.parentNodeId] : []),
        ...(generation?.sourceImageNodeId ? [generation.sourceImageNodeId] : []),
      ];
      const sourceNodeIds = [...new Set(candidateSourceIds.map((id) => String(id || "").trim()).filter((id) => id && id !== node.id))]
        .filter((id) => nodesById.has(id));
      const relation = fallbackRelationForNode(node);
      const edges = sourceNodeIds.map((fromId) => persistedEdges.find((edge) => edge.fromId === fromId)
        || createProvenanceEdge({
          fromId,
          toId: node.id,
          relation,
          ...(generation?.taskId ? { taskId: generation.taskId } : {}),
        }));
      return { resultNodeId: node.id, sourceNodeIds, edges };
    });
}

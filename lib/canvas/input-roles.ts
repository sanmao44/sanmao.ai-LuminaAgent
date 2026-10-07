import { nodeById } from "@/lib/canvas/model";
import { referenceNodesForCanvasEdge } from "@/lib/canvas/reference-edges";
import { inferCanvasInputRole } from "@/lib/canvas/references";
import type {
  CanvasDocument,
  CanvasInputRole,
  CanvasNode,
} from "@/lib/canvas/types";
import type { CanvasVideoInputMode } from "@/lib/canvas/references";

/**
 * Projects persisted incoming edges into the input role map consumed by video
 * request preparation. CanvasWorkspace retains all mutation and synchronization
 * ownership; this function only reads the document and returns a new map.
 */
export function canvasInputRolesForTarget(document: CanvasDocument, targetId: string) {
  const target = nodeById(document, targetId);
  const roles = new Map<string, CanvasInputRole | undefined>();
  const referenceEdges = document.edges.filter(
    (edge) => edge.target === targetId && !["generated", "variant", "lineage"].includes(edge.kind || ""),
  );
  const sourceNodes = referenceEdges.flatMap((edge) => referenceNodesForCanvasEdge(document, edge));
  const directIds = new Set(sourceNodes.map((node) => node.id));
  const storedOrder = target?.data.referenceOrder?.length
    ? target.data.referenceOrder
    : target?.data.generation?.referenceIds || [];
  const orderedIds = [
    ...storedOrder.filter((id) => directIds.has(id)),
    ...sourceNodes.map((node) => node.id).filter((id, index, values) => !storedOrder.includes(id) && values.indexOf(id) === index),
  ];
  const imagePosition = new Map<string, number>();
  orderedIds.forEach((id) => {
    const node = nodeById(document, id);
    if (!node || node.data.kind !== "image") return;
    imagePosition.set(id, imagePosition.size);
  });
  referenceEdges
    .slice()
    .sort((left, right) => {
      const leftOrder = Number(left.order);
      const rightOrder = Number(right.order);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder)) return leftOrder - rightOrder;
      if (Number.isFinite(leftOrder) !== Number.isFinite(rightOrder)) return Number.isFinite(leftOrder) ? -1 : 1;
      return 0;
    })
    .forEach((edge) => {
      const sources = referenceNodesForCanvasEdge(document, edge);
      if (!sources.length) return;
      sources.forEach((source) => {
        const current = imagePosition.get(source.id) || 0;
        roles.set(
          source.id,
          sources.length === 1 && edge.inputRole
            ? edge.inputRole
            : target
              ? inferCanvasInputRole(
                source,
                target,
                target.data.params && "inputMode" in target.data.params
                  ? target.data.params.inputMode as CanvasVideoInputMode
                  : undefined,
                current,
              )
              : undefined,
        );
      });
    });
  return roles;
}

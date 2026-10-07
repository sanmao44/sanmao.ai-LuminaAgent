import {
  groupById,
  groupNodes,
  isCanvasReferenceableNode,
  nodeById,
} from "@/lib/canvas/model";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "@/lib/canvas/types";

/**
 * Projects a reference edge into the concrete referenceable nodes it targets.
 * Group expansion is explicit: a member edge stays scoped to that member.
 */
export function referenceNodesForCanvasEdge(document: CanvasDocument, edge: CanvasEdge) {
  const sourceGroup = groupById(document, edge.source);
  if (!sourceGroup) {
    const source = nodeById(document, edge.source);
    return source && isCanvasReferenceableNode(source) ? [source] : [];
  }
  if (Array.isArray(edge.sourceNodeIds)) {
    return [...new Set(edge.sourceNodeIds)]
      .map((id) => nodeById(document, id))
      .filter((node): node is CanvasNode => Boolean(node && isCanvasReferenceableNode(node)));
  }
  return groupNodes(document, sourceGroup.id).filter(isCanvasReferenceableNode);
}

/**
 * Returns reference edges for a target in persisted order, excluding edges
 * that represent generated output, variants, or lineage.
 */
export function referenceEdgesForCanvasTarget(document: CanvasDocument, targetId: string) {
  return document.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) =>
      edge.target === targetId &&
      !["generated", "variant", "lineage"].includes(edge.kind || "") &&
      referenceNodesForCanvasEdge(document, edge).length > 0,
    )
    .sort((left, right) => {
      const leftOrder = Number(left.edge.order);
      const rightOrder = Number(right.edge.order);
      const leftHasOrder = Number.isFinite(leftOrder);
      const rightHasOrder = Number.isFinite(rightOrder);
      if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
      return left.index - right.index;
    });
}

/** Returns reference edge IDs connecting a source to a target. */
export function referenceEdgeIdsForCanvasSource(
  document: CanvasDocument,
  targetId: string,
  sourceId: string,
) {
  return referenceEdgesForCanvasTarget(document, targetId)
    .filter(({ edge }) =>
      edge.source === sourceId ||
      referenceNodesForCanvasEdge(document, edge).some((node) => node.id === sourceId),
    )
    .map(({ edge }) => edge.id);
}

import {
  groupById,
  groupNodes,
  incomingReferences,
  isCanvasReadyImageSource,
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

/**
 * Returns the image inputs for continuing a generated image. Older outputs
 * stored reference IDs without materializing the corresponding reference edges.
 */
export function canvasImageReferencesForContinuation(
  document: CanvasDocument,
  targetId: string,
) {
  const targetEdges = referenceEdgesForCanvasTarget(document, targetId);
  const connectedImageNodes = targetEdges
    .flatMap(({ edge }) => referenceNodesForCanvasEdge(document, edge))
    .filter((node) => node.data.kind === "image");
  const imageInputIds = new Set(
    targetEdges
      .filter(({ edge }) => edge.inputRole === undefined || edge.inputRole === "reference-image")
      .flatMap(({ edge }) => referenceNodesForCanvasEdge(document, edge))
      .filter((node) => node.data.kind === "image")
      .map((node) => node.id),
  );
  const connected = incomingReferences(document, targetId).filter(
    (node) => node.data.kind === "image" && imageInputIds.has(node.id),
  );
  if (connectedImageNodes.length) return connected.filter(isCanvasReadyImageSource);

  const target = nodeById(document, targetId);
  const storedIds = target?.data.referenceOrder?.length
    ? target.data.referenceOrder
    : target?.data.generation?.referenceIds || [];
  const seen = new Set<string>();
  return storedIds
    .map((id) => nodeById(document, id))
    .filter((node): node is CanvasNode => Boolean(
      node && node.id !== targetId && isCanvasReadyImageSource(node) && !seen.has(node.id) && seen.add(node.id),
    ));
}

/** Keep each output's image inputs aligned with the references sent to generation. */
export function attachCanvasImageReferenceEdges(
  document: CanvasDocument,
  references: readonly CanvasNode[],
  targetIds: readonly string[],
  createEdgeId: () => string,
) {
  const imageReferences = [...new Map(
    references
      .filter(isCanvasReadyImageSource)
      .map((node) => [node.id, node]),
  ).values()];
  const targets = [...new Set(targetIds)];
  const desiredByTarget = new Map(
    targets.map((targetId) => [
      targetId,
      imageReferences.filter((reference) => reference.id !== targetId),
    ]),
  );
  const connectedByTarget = new Map<string, Set<string>>(
    targets.map((targetId) => [targetId, new Set<string>()]),
  );
  const edges: CanvasEdge[] = [];

  for (const edge of document.edges) {
    const desired = desiredByTarget.get(edge.target);
    if (
      !desired ||
      ["generated", "variant", "lineage"].includes(edge.kind || "") ||
      (edge.inputRole !== undefined && edge.inputRole !== "reference-image")
    ) {
      edges.push(edge);
      continue;
    }

    const sourceGroup = groupById(document, edge.source);
    if (sourceGroup) {
      const memberIds = edge.sourceNodeIds || sourceGroup.nodeIds;
      const nonImageIds = memberIds.filter((id) => nodeById(document, id)?.data.kind !== "image");
      if (nonImageIds.length === memberIds.length) {
        edges.push(edge);
      } else if (nonImageIds.length) {
        edges.push({ ...edge, sourceNodeIds: nonImageIds });
      }
      continue;
    }

    const source = nodeById(document, edge.source);
    if (source?.data.kind !== "image") {
      edges.push(edge);
      continue;
    }

    const order = desired.findIndex((reference) => reference.id === source.id);
    const connected = connectedByTarget.get(edge.target);
    if (order < 0 || !connected || connected.has(source.id)) continue;
    connected.add(source.id);
    edges.push(
      edge.inputRole === "reference-image" && edge.order === order
        ? edge
        : { ...edge, inputRole: "reference-image", order },
    );
  }

  for (const targetId of targets) {
    const desired = desiredByTarget.get(targetId) || [];
    const connected = connectedByTarget.get(targetId);
    for (const [order, reference] of desired.entries()) {
      if (connected?.has(reference.id)) continue;
      edges.push({
        id: createEdgeId(),
        source: reference.id,
        target: targetId,
        sourcePort: "right",
        targetPort: "left",
        inputRole: "reference-image",
        order,
        kind: "reference",
      });
      connected?.add(reference.id);
    }
  }

  return edges.length === document.edges.length && edges.every((edge, index) => edge === document.edges[index])
    ? document
    : { ...document, edges };
}

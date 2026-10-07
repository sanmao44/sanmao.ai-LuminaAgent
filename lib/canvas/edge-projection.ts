import { canvasNodeColorKey, type CanvasNodeColorKey } from "./appearance";
import { isCanvasGridComposeLineageEdge, nodeSize } from "./model";
import type { CanvasDocument, CanvasNode } from "./types";

/** Build the edge color lookup from the first existing member of each group. */
export function canvasEdgeColorKeysByEntityId(
  nodes: readonly CanvasNode[],
  groups: CanvasDocument["groups"],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const colorById = new Map<string, CanvasNodeColorKey>();
  for (const node of nodes) colorById.set(node.id, canvasNodeColorKey(node));
  for (const group of groups) {
    const firstMember = group.nodeIds
      .map((id) => nodeById.get(id))
      .find((node): node is CanvasNode => Boolean(node));
    colorById.set(
      group.id,
      firstMember ? canvasNodeColorKey(firstMember) : "image",
    );
  }
  return colorById;
}

/** Build stable geometry signatures used to memoize edge endpoint rendering. */
export function canvasEdgeGeometryKeysByEntityId(
  nodes: readonly CanvasNode[],
  groups: CanvasDocument["groups"],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const geometryById = new Map<string, string>();
  for (const node of nodes) {
    const size = nodeSize(node);
    geometryById.set(
      node.id,
      `n:${node.id}:${node.x}:${node.y}:${size.w}x${size.h}`,
    );
  }
  for (const group of groups) {
    const members = group.nodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is CanvasNode => Boolean(node));
    geometryById.set(
      group.id,
      `g:${group.id}:${members
        .map((node) => {
          const size = nodeSize(node);
          return `${node.id}:${node.x}:${node.y}:${size.w}x${size.h}`;
        })
        .join("|")}`,
    );
  }
  return geometryById;
}

/** Keep only edges whose endpoints are currently rendered on the canvas. */
export function visibleCanvasEdgeProjection(
  document: CanvasDocument,
  visibleNodeIds: ReadonlySet<string>,
  groupIds: ReadonlySet<string>,
) {
  return document.edges.filter((edge) => {
    const sourceVisible = visibleNodeIds.has(edge.source) || groupIds.has(edge.source);
    const targetVisible = visibleNodeIds.has(edge.target) || groupIds.has(edge.target);
    return sourceVisible && targetVisible && !isCanvasGridComposeLineageEdge(document, edge);
  });
}

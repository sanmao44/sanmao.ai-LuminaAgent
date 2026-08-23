import type { CanvasDocument, CanvasNode } from "./types";

export const CANVAS_NODE_COLOR_KEYS = [
  "image",
  "video",
  "agent",
  "image-generator",
  "video-generator",
] as const;

export type CanvasNodeColorKey = (typeof CANVAS_NODE_COLOR_KEYS)[number];

export function canvasNodeColorKey(
  node: Pick<CanvasNode, "type" | "data">,
): CanvasNodeColorKey {
  if (node.type === "prompt") return "agent";
  if (node.type === "generator")
    return node.data.kind === "video"
      ? "video-generator"
      : "image-generator";
  return node.data.kind === "video" ? "video" : "image";
}

export function canvasSourceColorKey(
  document: Pick<CanvasDocument, "nodes" | "groups">,
  sourceId: string,
): CanvasNodeColorKey {
  const sourceNode = document.nodes.find((node) => node.id === sourceId);
  if (sourceNode) return canvasNodeColorKey(sourceNode);

  const sourceGroup = document.groups.find((group) => group.id === sourceId);
  const firstGroupNode = sourceGroup?.nodeIds
    .map((id) => document.nodes.find((node) => node.id === id))
    .find((node): node is CanvasNode => Boolean(node));
  return firstGroupNode ? canvasNodeColorKey(firstGroupNode) : "image";
}

import type { CanvasNode } from "@/lib/canvas/types";

export function canvasNodeSupportsImagePresets(node: CanvasNode) {
  return node.type !== "generator" && node.type !== "prompt" && node.type !== "upscale" && node.data.kind === "image";
}

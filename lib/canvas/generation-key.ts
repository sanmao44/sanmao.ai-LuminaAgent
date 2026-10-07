import type { CanvasNode } from "./types";

export type CanvasGenerationKeySource = {
  node?: CanvasNode | null;
  target?: CanvasNode | null;
  kind: string;
};

/** Return the stable in-flight key shared by canvas generation entry points. */
export function canvasGenerationKey(source: CanvasGenerationKeySource) {
  return source.node?.id || source.target?.id || `draft:${source.kind}`;
}

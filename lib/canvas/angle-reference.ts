import type { ClientReferenceImage } from "../types";
import type { CanvasNode } from "./types";

export type CanvasReadyImagePredicate = (
  node: CanvasNode | undefined,
) => boolean;

/** Project a ready canvas image into the existing angle/reference contract. */
export function canvasAngleReference(
  node: CanvasNode | undefined,
  isReadyImageSource: CanvasReadyImagePredicate,
): ClientReferenceImage | null {
  if (!isReadyImageSource(node) || node?.data.kind !== "image" || !node.data.url) {
    return null;
  }
  const url = String(node.data.url);
  return {
    id: node.id,
    name: String(node.data.name || "原始参考图"),
    kind: "image",
    url,
    ...(url.startsWith("data:") ? { dataUrl: url } : {}),
  };
}

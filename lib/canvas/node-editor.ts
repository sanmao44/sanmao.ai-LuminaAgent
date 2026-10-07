import { incomingReferences, normalizeVariantRequirements } from "@/lib/canvas/model";
import { shouldGenerateVideoInPlace } from "@/lib/canvas/references";
import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";

export function variantRequirementsFor(node: CanvasNode) {
  return normalizeVariantRequirements(node.data.variantRequirements);
}

export function canvasVideoTargetHasImageReference(
  document: CanvasDocument,
  target: CanvasNode | null | undefined,
) {
  return Boolean(
    target &&
      shouldGenerateVideoInPlace(
        target,
        incomingReferences(document, target.id),
      ),
  );
}

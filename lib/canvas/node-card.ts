import { incomingReferences, isCanvasReadyImageSource, normalizeVariantRequirements } from "@/lib/canvas/model";
import { canvasMaskStateFromParams, normalizeCanvasMaskState } from "@/lib/canvas/mask";
import type { CanvasDocument, CanvasNode, CanvasVariantState } from "@/lib/canvas/types";

export function maskStateForNode(node: CanvasNode) {
  if (node.type !== "media" || node.data.kind !== "image") return undefined;
  const legacyMask = canvasMaskStateFromParams(node.data.generation?.params) || canvasMaskStateFromParams(node.data.params);
  return normalizeCanvasMaskState(node.data.mask, legacyMask);
}

export function canvasUpscaleSource(document: CanvasDocument, nodeId: string) {
  return incomingReferences(document, nodeId).find((item) => isCanvasReadyImageSource(item));
}

export function nodeStatus(node: CanvasNode) {
  if (node.data.status === "queued" || node.data.status === "running")
    return node.data.statusLabel || "???";
  if (node.data.status === "failed")
    return node.data.statusLabel || "????????";
  if (!node.data.url && node.data.status === "draft")
    return node.data.statusLabel || "????????";
  return node.data.role || "????";
}

export function progressValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function variantRequirementsFor(node: CanvasNode) {
  return normalizeVariantRequirements(node.data.variantRequirements);
}

export function variantStatesFor(node: CanvasNode): CanvasVariantState[] {
  const requirements = variantRequirementsFor(node);
  return requirements.map((instruction, index) => {
    const current = node.data.variantStates?.[index];
    return {
      id: String(current?.id || `variant-${index + 1}`),
      instruction,
      status: current?.status || "pending",
      resultIds: current?.resultIds || [],
      ...(current?.taskIds ? { taskIds: current.taskIds } : {}),
      ...(typeof current?.progress === "number" ? { progress: current.progress } : {}),
      ...(current?.error ? { error: current.error } : {}),
      ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}),
    };
  });
}

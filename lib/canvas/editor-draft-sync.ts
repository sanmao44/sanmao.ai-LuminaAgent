import { nodeById } from "@/lib/canvas/model";
import { normalizeCreationSettings } from "@/lib/creation/settings";
import type {
  CanvasDocument,
  CanvasGenerationParams,
  CanvasNode,
  CanvasRuntimeState,
} from "@/lib/canvas/types";
import type { CanvasReferenceDraft } from "@/lib/canvas/reuse";

export type CanvasEditorDraft = {
  prompt: string;
  params?: CanvasGenerationParams;
  presetId?: string;
  presetName?: string;
  sourceNodeId?: string;
  references?: CanvasReferenceDraft[];
  operation?: "generate" | "edit" | "extend";
  dirty?: boolean;
};

function videoParamsForNode(node: CanvasNode, runtime: CanvasRuntimeState | null) {
  const currentParams =
    node.data.params && typeof node.data.params === "object"
      ? node.data.params
      : node.data.generation?.params;
  return normalizeCreationSettings("video", currentParams, runtime);
}

/** Keep open video editor drafts aligned with synchronized node input modes. */
export function syncCanvasEditorDraftInputModes(
  drafts: Record<string, CanvasEditorDraft>,
  document: CanvasDocument,
  runtime: CanvasRuntimeState | null,
) {
  let next = drafts;
  Object.entries(drafts).forEach(([nodeId, draft]) => {
    if (!draft.params || draft.params.kind !== "video") return;
    const node = nodeById(document, nodeId);
    if (!node || node.data.kind !== "video") return;
    const params = videoParamsForNode(node, runtime);
    if (draft.params.inputMode === params.inputMode) return;
    if (next === drafts) next = { ...drafts };
    next[nodeId] = {
      ...draft,
      params: { ...draft.params, inputMode: params.inputMode },
    };
  });
  return next;
}

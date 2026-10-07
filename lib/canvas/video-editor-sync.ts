import {
  incomingContext,
  isCanvasReferenceableNode,
  nodeById,
} from "@/lib/canvas/model";
import {
  normalizeVideoEditorState,
  syncVideoEditorInputs,
  type CanvasVideoEditorInput,
} from "@/lib/canvas/video-editor";
import type { CanvasDocument } from "@/lib/canvas/types";

/**
 * Reconciles connected canvas media into each video editor node's persisted
 * timeline input state. This is an immutable document projection; callers own
 * when the returned document is committed to CanvasCore.
 */
export function syncCanvasVideoEditorReferences(document: CanvasDocument) {
  let next = document;
  for (const initialTarget of document.nodes) {
    if (initialTarget.type !== "video-editor") continue;
    const target = nodeById(next, initialTarget.id);
    if (!target || target.type !== "video-editor") continue;
    const inputs: CanvasVideoEditorInput[] = incomingContext(next, target.id)
      .filter(isCanvasReferenceableNode)
      .map((source) => ({
        nodeId: source.id,
        kind: source.data.kind || "image",
        name: String(source.data.name || "素材"),
        ...(Number(source.data.durationMs) > 0
          ? { durationSeconds: Number(source.data.durationMs) / 1000 }
          : {}),
      }));
    const current = normalizeVideoEditorState(target.data.videoEditor);
    const updated = syncVideoEditorInputs(current, inputs);
    if (JSON.stringify(updated) === JSON.stringify(current) && target.data.videoEditor) continue;
    next = {
      ...next,
      nodes: next.nodes.map((node) =>
        node.id === target.id
          ? { ...node, data: { ...node.data, videoEditor: updated } }
          : node,
      ),
    };
  }
  return next;
}

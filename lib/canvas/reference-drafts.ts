import type { CanvasNode } from "./types";
import type { CanvasReferenceDraft } from "./reuse";
import { isCanvasReferenceableNode } from "./model";

export type CanvasReferenceableNodePredicate = (
  node: CanvasNode | undefined,
) => boolean;

export function createCanvasReferenceDraft(
  node: CanvasNode,
  isReferenceableNode: CanvasReferenceableNodePredicate = isCanvasReferenceableNode,
): CanvasReferenceDraft | null {
  if (node.type === "prompt") {
    const text = String(node.data.agentResponse || node.data.text || "").trim();
    if (!text) return null;
    return {
      id: `node-ref:${node.id}`,
      nodeId: node.id,
      kind: "text",
      text,
      mimeType: "text/plain;charset=utf-8",
      name: String(node.data.name || node.data.role || "文本引用"),
      origin: "node",
    };
  }
  if (node.type === "generator") {
    const text = String(node.data.prompt || node.data.agentPrompt || "").trim();
    if (!text) return null;
    return {
      id: `node-ref:${node.id}`,
      nodeId: node.id,
      kind: "text",
      text,
      mimeType: "text/plain;charset=utf-8",
      name: String(node.data.name || "生成提示词"),
      origin: "node",
    };
  }
  if (!isReferenceableNode(node) || !node.data.kind) return null;
  return {
    id: `node-ref:${node.id}`,
    nodeId: node.id,
    kind: node.data.kind,
    url: String(node.data.url),
    name: String(node.data.name || (node.data.kind === "video" ? "视频素材" : node.data.kind === "audio" ? "音频素材" : "图片素材")),
    ...(node.data.mimeType ? { mimeType: String(node.data.mimeType) } : {}),
    origin: "node",
  };
}

export function createCanvasReferenceRecords(
  nodes: CanvasNode[],
  isReferenceableNode: CanvasReferenceableNodePredicate = isCanvasReferenceableNode,
) {
  const seen = new Set<string>();
  return nodes
    .map((node) => {
      const draft = createCanvasReferenceDraft(node, isReferenceableNode);
      if (!draft || draft.kind === "audio" || seen.has(node.id)) return null;
      seen.add(node.id);
      return {
        id: node.id,
        kind: draft.kind,
        name: draft.name,
        url: draft.url || "",
        ...(draft.text ? { text: draft.text } : {}),
        ...(draft.mimeType ? { mimeType: draft.mimeType } : {}),
      };
    })
    .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference));
}

export function isCanvasReferencePickerCandidate(node: CanvasNode | undefined) {
  return Boolean(
    node &&
      (node.type === "prompt" ||
        node.type === "generator" ||
        isCanvasReferenceableNode(node)),
  );
}

import type { ReferenceMentionOption } from "@/components/ReferenceMentionMenu";
import { isCanvasReferenceableNode } from "@/lib/canvas/model";
import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";

function canvasMentionPreviewNode(document: CanvasDocument, node: CanvasNode) {
  if (isCanvasReferenceableNode(node)) return node;
  const outputIds = new Set(
    document.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target),
  );
  return document.nodes.find((candidate) =>
    candidate.type === "media" &&
    Boolean(candidate.data.url) &&
    (candidate.data.generation?.sourceGeneratorId === node.id ||
      candidate.data.generation?.parentNodeId === node.id ||
      outputIds.has(candidate.id)),
  );
}

export function canvasMentionOption(
  document: CanvasDocument,
  node: CanvasNode,
  index = 0,
): ReferenceMentionOption {
  const preview = canvasMentionPreviewNode(document, node);
  const text = node.type === "prompt"
    ? String(node.data.agentResponse || node.data.text || node.data.agentPrompt || "").trim()
    : node.type === "generator"
      ? String(node.data.prompt || node.data.agentPrompt || "").trim()
      : "";
  const kind: ReferenceMentionOption["kind"] = node.type === "prompt" || node.type === "generator"
    ? "text"
    : node.data.kind === "video" ? "video" : "image";
  const previewKind = preview?.data.kind === "video" ? "video" : "image";
  return {
    id: node.id,
    kind,
    name: String(node.data.name || (node.type === "prompt" ? `Agent 文本${index + 1}` : node.type === "generator" ? `生成器${index + 1}` : node.data.kind === "video" ? `视频${index + 1}` : `图片${index + 1}`)),
    ...(preview?.data.url ? { thumbnailUrl: String(preview.data.url), thumbnailKind: previewKind } : {}),
    ...(node.type !== "prompt" && node.type !== "generator" && node.data.url ? { url: String(node.data.url) } : {}),
    ...(text ? { text } : {}),
  };
}

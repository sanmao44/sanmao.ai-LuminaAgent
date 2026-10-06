import type { CanvasNode } from "./types";

export type CanvasMentionableNodePredicate = (
  node: CanvasNode | undefined,
) => boolean;

export function mentionedCanvasMedia(
  prompt: string,
  candidates: CanvasNode[],
  isReferenceableNode: CanvasMentionableNodePredicate,
) {
  const ids = [...prompt.matchAll(/@([0-9]+)/g)]
    .map((match) => Number(match[1]) - 1)
    .filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < candidates.length,
    )
    .map((index) => candidates[index].id);
  return candidates.filter(
    (node) => ids.includes(node.id) && isReferenceableNode(node),
  );
}

export function resolveCanvasMentionTokens(
  prompt: string,
  candidates: CanvasNode[],
) {
  return prompt.replace(/@([0-9]+)/g, (token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const candidate =
      index >= 0 && index < candidates.length ? candidates[index] : undefined;
    return candidate
      ? candidate.type === "prompt"
        ? `引用文本${index + 1}`
        : candidate.data.kind === "video"
          ? `参考视频${index + 1}`
          : `参考图${index + 1}`
      : token;
  });
}

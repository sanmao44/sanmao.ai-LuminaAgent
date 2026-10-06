import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";
import type { SmartVariantSource } from "@/lib/canvas/model";

export function canvasSmartVariantSources(
  document: CanvasDocument,
  selectedNode: CanvasNode | null | undefined,
): SmartVariantSource[] {
  if (selectedNode?.type !== "generator") return [];
  const directIds = new Set(
    document.edges
      .filter((edge) => edge.target === selectedNode.id && !["generated", "variant", "lineage"].includes(edge.kind || ""))
      .map((edge) => edge.source),
  );
  const agents = document.nodes
    .filter((node) => directIds.has(node.id))
    .filter((node) => node.type === "prompt")
    .map((node) => ({
      id: node.id,
      name: String(node.data.name || "Agent"),
      text: String(node.data.agentResponse || node.data.text || node.data.agentPrompt || "").trim(),
    }))
    .filter((item) => item.text);
  if (!agents.length) return [];
  return [
    { id: "shared-prompt", name: "共同提示词", text: String(selectedNode.data.prompt || "").trim() },
    ...agents,
  ].filter((item) => item.text);
}

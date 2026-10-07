import { compileLocalEditPrompt, type LocalEditAnnotation } from "@/lib/local-edit";
import type { CanvasGenerationParams, CanvasNode } from "@/lib/canvas/types";
import type { ImageCreationSettings } from "@/lib/creation/settings";

/**
 * Compiles the visible local-edit prompt with whichever persisted mask source
 * is available, while keeping the existing precedence used by CanvasWorkspace.
 */
export function compiledCanvasLocalEditPrompt(
  node: CanvasNode,
  prompt: string,
  draftParams?: CanvasGenerationParams,
) {
  const masks = [
    node.data.mask,
    (draftParams as ImageCreationSettings | undefined)?.mask,
    (node.data.generation?.params as ImageCreationSettings | undefined)?.mask,
    (node.data.params as ImageCreationSettings | undefined)?.mask,
  ];
  const annotations = masks
    .map((mask) => mask?.annotations)
    .find((items): items is LocalEditAnnotation[] => Boolean(items?.length));
  return annotations ? compileLocalEditPrompt(prompt, annotations) : prompt;
}

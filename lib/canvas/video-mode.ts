import { normalizeCreationSettings, type VideoCreationSettings } from "@/lib/creation/settings";
import type { CanvasDocument, CanvasInputRole, CanvasNode, CanvasRuntimeState } from "@/lib/canvas/types";
import type { CanvasVideoInputMode } from "@/lib/canvas/references";

export function videoParamsForCanvasNode(node: CanvasNode, runtime: CanvasRuntimeState | null) {
  const currentParams = node.data.params && typeof node.data.params === "object"
    ? node.data.params
    : node.data.generation?.params;
  return normalizeCreationSettings("video", currentParams, runtime);
}

export function updateCanvasVideoMode(
  document: CanvasDocument,
  targetId: string,
  inputMode: CanvasVideoInputMode,
  runtime: CanvasRuntimeState | null = null,
) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== targetId || (node.type !== "media" && node.type !== "generator")) return node;
      if (node.data.kind !== "video") return node;
      const params = videoParamsForCanvasNode(node, runtime);
      const nextParams = { ...params, inputMode } as VideoCreationSettings;
      return {
        ...node,
        data: {
          ...node.data,
          params: nextParams,
          generation: node.data.generation
            ? { ...node.data.generation, params: nextParams }
            : node.data.generation,
        },
      };
    }),
  };
}

export function updateCanvasVideoModeAuto(document: CanvasDocument, targetId: string, automatic: boolean) {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === targetId &&
      (node.type === "media" || node.type === "generator") &&
      node.data.kind === "video"
        ? {
            ...node,
            data: {
              ...node.data,
              videoInputModeAuto: automatic,
              videoInputModeLocked: !automatic,
            },
          }
        : node,
    ),
  };
}

export function defaultCanvasVideoInputRole(
  node: CanvasNode,
  inputMode: CanvasVideoInputMode,
  imagePosition: number,
): CanvasInputRole | undefined {
  if (node.data.kind === "audio") return "audio";
  if (node.data.kind === "video") return "video";
  if (inputMode === "frames") return imagePosition === 0 ? "first-frame" : imagePosition === 1 ? "last-frame" : "reference-image";
  if (inputMode === "first-frame") return imagePosition === 0 ? "first-frame" : "reference-image";
  return "reference-image";
}

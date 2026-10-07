import type { CanvasRuntimeState } from "./types";
import type { CanvasVideoInputCapabilities } from "./references";
import {
  resolveAvailableCreationModel,
  type VideoCreationSettings,
} from "../creation/settings";

/**
 * Resolve the selected video model once and expose the capability projection
 * used by canvas connection and submission flows.
 *
 * The model registry and creation settings remain authoritative. This module
 * only translates their existing capability names into the canvas input
 * contract; it does not choose providers or mutate canvas state.
 */
export function canvasVideoInputCapabilities(
  settings: VideoCreationSettings,
  runtime: CanvasRuntimeState | null,
): Omit<CanvasVideoInputCapabilities, "supportsReference" | "supportsFirstFrame" | "supportsFrames" | "supportsAudio"> &
  Required<Pick<CanvasVideoInputCapabilities, "supportsReference" | "supportsFirstFrame" | "supportsFrames" | "supportsAudio">> &
  ReturnType<typeof resolveAvailableCreationModel> {
  const resolved = resolveAvailableCreationModel(settings, runtime);
  const model = resolved.model;
  const capabilities = model?.capabilities || [];
  return {
    supportsReference:
      !model ||
      capabilities.includes("video-reference") ||
      capabilities.includes("video-generate"),
    supportsFirstFrame:
      !model ||
      capabilities.includes("video-first-frame") ||
      capabilities.includes("video-generate"),
    supportsFrames:
      !model ||
      capabilities.includes("video-first-frame") ||
      capabilities.includes("video-generate"),
    supportsAudio: !model || capabilities.includes("video-audio"),
    model,
  };
}

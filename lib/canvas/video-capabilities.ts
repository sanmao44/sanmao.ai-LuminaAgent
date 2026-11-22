import type { CanvasRuntimeState } from "./types";
import type { CanvasVideoInputCapabilities } from "./references";
import { usesCangyuanVideoProtocol } from "../cangyuan-provider";
import { getCangyuanVideoModelProfile } from "../cangyuan-video-capabilities";
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
  const provider = runtime?.providers?.find((item) => item.id === model?.providerId);
  if (model && usesCangyuanVideoProtocol(provider)) {
    const profile = getCangyuanVideoModelProfile(model.rawId);
    return {
      supportsReference: Boolean(profile?.supportsReferenceImages || profile?.supportsReferenceVideos || profile?.supportsReferenceAudios),
      supportsFirstFrame: Boolean(profile?.supportsFirstFrame && profile.allowsFirstFrameWithoutLastFrame !== false),
      supportsFrames: Boolean(profile?.supportsFirstFrame && profile.supportsLastFrame),
      supportsAudio: Boolean(profile?.supportsReferenceAudios),
      model,
    };
  }
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

import { mediaCardSizeForRatio, upscaleCardSizeForRatio } from "./model";
import { normalizeCanvasVideoClipState, videoClipDurationSeconds } from "./video-clip";
import type { CanvasDocument, CanvasNode } from "./types";

export type CanvasMediaNaturalSize = {
  nodeId: string;
  width: number;
  height: number;
  durationSeconds?: number;
  sourceUrl?: string;
};

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function applyCanvasMediaNaturalSizes(
  document: CanvasDocument,
  measurements: readonly CanvasMediaNaturalSize[],
) {
  const byNodeId = new Map<string, CanvasMediaNaturalSize[]>();
  for (const measurement of measurements) {
    const values = byNodeId.get(measurement.nodeId) || [];
    values.push(measurement);
    byNodeId.set(measurement.nodeId, values);
  }

  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.type !== "media" && node.type !== "upscale") return node;
    const candidates = byNodeId.get(node.id);
    if (!candidates?.length) return node;
    const sourceUrl = String(node.data.url || "");
    let measurement: CanvasMediaNaturalSize | undefined;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (candidate.sourceUrl === undefined || candidate.sourceUrl === sourceUrl) {
        measurement = candidate;
        break;
      }
    }
    if (!measurement) return node;

    const hasNaturalSize = isPositiveFinite(measurement.width) && isPositiveFinite(measurement.height);
    const durationSeconds = measurement.durationSeconds;
    const durationMs = durationSeconds !== undefined && isPositiveFinite(durationSeconds)
      ? Math.round(durationSeconds * 1000)
      : undefined;
    if (!hasNaturalSize && durationMs === undefined) return node;

    const dimensionsChanged = hasNaturalSize && (
      node.data.nativeWidth !== measurement.width || node.data.nativeHeight !== measurement.height
    );
    const videoClip = node.type === "media" && node.data.kind === "video"
      ? normalizeCanvasVideoClipState(
          node.data.videoClip,
          durationMs !== undefined
            ? durationMs / 1000
            : Number(node.data.sourceDurationMs || node.data.durationMs) / 1000,
        )
      : undefined;
    const effectiveDurationMs = videoClip
      ? Math.round(videoClipDurationSeconds(videoClip) * 1000)
      : durationMs;
    const sourceDurationChanged = Boolean(
      videoClip && durationMs !== undefined && node.data.sourceDurationMs !== durationMs,
    );
    const durationChanged = effectiveDurationMs !== undefined && node.data.durationMs !== effectiveDurationMs;
    const nextSize = hasNaturalSize && node.data.autoFit !== false
      ? node.type === "upscale"
        ? upscaleCardSizeForRatio(measurement.width / measurement.height)
        : mediaCardSizeForRatio(measurement.width / measurement.height, node.data.kind || "image")
      : null;
    const cardSizeChanged = Boolean(nextSize && (node.w !== nextSize.w || node.h !== nextSize.h));
    if (!dimensionsChanged && !durationChanged && !sourceDurationChanged && !cardSizeChanged) return node;

    changed = true;
    return {
      ...node,
      ...(nextSize || {}),
      data: {
        ...node.data,
        ...(hasNaturalSize
          ? { nativeWidth: measurement.width, nativeHeight: measurement.height }
          : {}),
        ...(effectiveDurationMs !== undefined ? { durationMs: effectiveDurationMs } : {}),
        ...(sourceDurationChanged ? { sourceDurationMs: durationMs } : {}),
      },
    } as CanvasNode;
  });

  return changed ? { ...document, nodes } : document;
}

import type { GalleryLocalEditMask } from "../client-history";
import type { ImageCreationSettings } from "../creation/settings";

/** Convert a canvas image mask into the persisted history mask contract. */
export function canvasHistoryMask(
  mask: ImageCreationSettings["mask"],
): GalleryLocalEditMask | undefined {
  if (!mask?.url) return undefined;
  const parsedFeather = Number(mask.feather);
  return {
    dataUrl: mask.url,
    feather: Number.isFinite(parsedFeather)
      ? Math.max(0, Math.min(48, Math.round(parsedFeather)))
      : 0,
    ...(mask.annotations?.length ? { annotations: mask.annotations } : {}),
  };
}

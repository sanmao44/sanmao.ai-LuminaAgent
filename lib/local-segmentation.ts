import type { LocalEditPoint } from "./local-edit";

export type LocalSegmentationStatus = "unavailable" | "loading" | "ready" | "error";

export type LocalSegmentationResult = {
  /** A transparent/opaque PNG mask in the same dimensions as the source image. */
  maskDataUrl: string;
  bounds?: { x: number; y: number; width: number; height: number };
  label?: string;
};

export type LocalSegmentationProvider = {
  id: string;
  modelName: string;
  status: () => LocalSegmentationStatus;
  load?: () => Promise<void>;
  segment: (imageDataUrl: string, point: LocalEditPoint) => Promise<LocalSegmentationResult>;
};

/**
 * The editor deliberately does not bundle a several-hundred-megabyte model.
 * An optional model loader can register a provider at runtime after downloading
 * and caching a compatible SAM/segmentation model locally. This keeps the base
 * app free of API charges and leaves manual/point selection fully functional.
 */
let registeredProvider: LocalSegmentationProvider | null = null;

export const LOCAL_SEGMENTATION_MODEL = {
  id: "sam-local-optional",
  label: "本地主体识别",
  cacheKey: "sanmao.local-segmentation.model.v1",
};

export function registerLocalSegmentationProvider(provider: LocalSegmentationProvider | null) {
  registeredProvider = provider;
}

export function getLocalSegmentationProvider() {
  if (registeredProvider) return registeredProvider;
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & {
    __SANMAO_LOCAL_SEGMENTER__?: LocalSegmentationProvider;
  }).__SANMAO_LOCAL_SEGMENTER__;
  return candidate || null;
}

export function localSegmentationStatus(): LocalSegmentationStatus {
  return getLocalSegmentationProvider()?.status() || "unavailable";
}

export function localSegmentationUnavailableMessage() {
  return "本地主体识别模型尚未安装；可继续使用点选或手动画区。";
}

export async function segmentLocalSubject(
  imageDataUrl: string,
  point: LocalEditPoint,
) {
  const provider = getLocalSegmentationProvider();
  if (!provider) throw new Error(localSegmentationUnavailableMessage());
  if (provider.status() !== "ready" && provider.load) await provider.load();
  if (provider.status() !== "ready") throw new Error("本地主体识别模型暂时不可用，请改用手动标记。 ");
  return provider.segment(imageDataUrl, point);
}

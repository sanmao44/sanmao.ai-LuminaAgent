import type { PublicState, RegistryModel } from "../types";
import { getLastModelCall } from "../model-preferences";
import { selectAutomaticModel } from "../model-selection";

export type ImageSizeMode = "system" | "custom";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageBackgroundMode =
  | "auto"
  | "api-transparent"
  | "local-transparent"
  | "opaque";
export type VideoOperation = "generate" | "edit" | "extend";
export type VideoInputMode = "text" | "first-frame" | "frames" | "reference";
export type AgentWebMode = "off" | "auto" | "always";

export type CanvasMaskAsset = {
  assetId?: string;
  url: string;
  referenceId?: string;
};

export type ImageCreationSettings = {
  kind: "image";
  model: string;
  aspect: string;
  customAspectWidth: number;
  customAspectHeight: number;
  sizeMode: ImageSizeMode;
  resolution: "1K" | "2K" | "3K" | "4K";
  width: number;
  height: number;
  count: number;
  quality: "自动" | "low" | "medium" | "high";
  outputFormat: ImageOutputFormat;
  backgroundMode: ImageBackgroundMode;
  mask?: CanvasMaskAsset;
  upscaleScale: 1 | 2 | 3 | 4;
  upscaleTarget: "auto" | "1K" | "2K" | "4K";
  upscaleSeed: number;
  upscaleColorCorrection: "wavelet" | "none";
  upscaleAlgorithm: "lanczos" | "bicubic" | "nearest";
};

export type VideoCreationSettings = {
  kind: "video";
  model: string;
  operation: VideoOperation;
  inputMode: VideoInputMode;
  duration: number;
  aspect: string;
  resolution: string;
  audio: boolean;
};

export type AgentCreationSettings = {
  kind: "text";
  model: string;
  webMode: AgentWebMode;
};

export type CreationSettings =
  | ImageCreationSettings
  | VideoCreationSettings
  | AgentCreationSettings;

export const IMAGE_RATIOS = [
  "自动",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
  "自定义",
] as const;
export const VIDEO_RATIOS = [
  "auto",
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;
export const IMAGE_SIZE_TIERS = [
  { value: "1K" as const, label: "1K", longEdge: 1280 },
  { value: "2K" as const, label: "2K", longEdge: 2048 },
  { value: "3K" as const, label: "3K", longEdge: 3072 },
  { value: "4K" as const, label: "4K", longEdge: 4096 },
];
export const IMAGE_QUALITY_OPTIONS = [
  {
    value: "自动" as const,
    label: "自动质量",
    description: "由模型选择合适质量",
  },
  { value: "low" as const, label: "低质量", description: "速度优先" },
  {
    value: "medium" as const,
    label: "中等质量",
    description: "质量与速度平衡",
  },
  { value: "high" as const, label: "高质量", description: "细节优先" },
];

export const SHARED_CREATION_SETTINGS_KEY = "sanmao-creation-defaults-v2";
const LEGACY_IMAGE_SETTINGS_KEY = "sanmao-generate-settings";
const CHANGE_EVENT = "sanmao-creation-defaults-change";

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function availableModel(
  runtime: PublicState | null | undefined,
  kind: "image" | "video" | "chat",
  modelId: unknown,
) {
  const id = typeof modelId === "string" ? modelId : "";
  if (!id || id === "auto") return "auto";
  const matches = runtime?.models.some(
    (model) =>
      model.id === id &&
      model.enabled &&
      model.published &&
      model.kind === kind,
  );
  return matches ? id : id;
}

export function imageModelOptions(runtime: PublicState | null | undefined) {
  return (runtime?.models || []).filter(
    (model) =>
      model.enabled &&
      model.published &&
      model.kind === "image" &&
      model.capabilities.includes("generate"),
  );
}

export function imageEditModelOptions(runtime: PublicState | null | undefined) {
  return (runtime?.models || []).filter(
    (model) =>
      model.enabled &&
      model.published &&
      model.kind === "image" &&
      model.capabilities.includes("edit"),
  );
}

export function videoModelOptions(runtime: PublicState | null | undefined) {
  return (runtime?.models || []).filter(
    (model) =>
      model.enabled &&
      model.published &&
      (model.kind === "video" ||
        model.capabilities.some((capability) =>
          capability.startsWith("video-"),
        )),
  );
}

export function agentModelOptions(runtime: PublicState | null | undefined) {
  return (runtime?.models || []).filter(
    (model) =>
      model.enabled &&
      model.published &&
      (model.kind === "chat" || model.capabilities.includes("chat")),
  );
}

export function defaultImageCreationSettings(
  runtime?: PublicState | null,
): ImageCreationSettings {
  return {
    kind: "image",
    model: "auto",
    aspect: "1:1",
    customAspectWidth: 16,
    customAspectHeight: 9,
    sizeMode: "system",
    resolution: "1K",
    width: 1024,
    height: 1024,
    count: 1,
    quality: "自动",
    outputFormat: "png",
    backgroundMode: "auto",
    upscaleScale: 2,
    upscaleTarget: "auto",
    upscaleSeed: 42,
    upscaleColorCorrection: "wavelet",
    upscaleAlgorithm: "lanczos",
  };
}

export function defaultVideoCreationSettings(
  runtime?: PublicState | null,
): VideoCreationSettings {
  return {
    kind: "video",
    model: "auto",
    operation: "generate",
    inputMode: "text",
    duration: 5,
    aspect: "16:9",
    resolution: "720p",
    audio: false,
  };
}

export function defaultAgentCreationSettings(
  runtime?: PublicState | null,
): AgentCreationSettings {
  return { kind: "text", model: "auto", webMode: "off" };
}

export function normalizeImageCreationSettings(
  value: unknown,
  runtime?: PublicState | null,
): ImageCreationSettings {
  const raw = objectValue(value);
  const fallback = defaultImageCreationSettings(runtime);
  const aspectCandidate = String(raw.aspect || raw.ratio || fallback.aspect);
  const resolutionCandidate = String(
    raw.resolution || raw.sizeTier || fallback.resolution,
  ).toUpperCase();
  const resolution = IMAGE_SIZE_TIERS.some(
    (item) => item.value === resolutionCandidate,
  )
    ? (resolutionCandidate as ImageCreationSettings["resolution"])
    : fallback.resolution;
  const sizeMode = raw.sizeMode === "custom" ? "custom" : "system";
  const outputFormat =
    raw.outputFormat === "jpeg" || raw.outputFormat === "webp"
      ? raw.outputFormat
      : "png";
  const backgroundMode =
    raw.backgroundMode === "api-transparent" ||
    raw.backgroundMode === "local-transparent" ||
    raw.backgroundMode === "opaque"
      ? raw.backgroundMode
      : "auto";
  const quality =
    raw.quality === "low" || raw.quality === "medium" || raw.quality === "high"
      ? raw.quality
      : "自动";
  const maskRaw = objectValue(raw.mask);
  const mask =
    typeof maskRaw.url === "string" && maskRaw.url
      ? {
          url: maskRaw.url,
          ...(typeof maskRaw.assetId === "string"
            ? { assetId: maskRaw.assetId }
            : {}),
          ...(typeof maskRaw.referenceId === "string"
            ? { referenceId: maskRaw.referenceId }
            : {}),
        }
      : undefined;
  return {
    kind: "image",
    model: availableModel(runtime, "image", raw.model || raw.modelId),
    aspect: IMAGE_RATIOS.includes(
      aspectCandidate as (typeof IMAGE_RATIOS)[number],
    )
      ? aspectCandidate
      : fallback.aspect,
    customAspectWidth: clampInteger(
      raw.customAspectWidth ?? raw.customRatioWidth,
      1,
      999,
      fallback.customAspectWidth,
    ),
    customAspectHeight: clampInteger(
      raw.customAspectHeight ?? raw.customRatioHeight,
      1,
      999,
      fallback.customAspectHeight,
    ),
    sizeMode,
    resolution,
    width: clampInteger(raw.width ?? raw.customWidth, 1, 16384, fallback.width),
    height: clampInteger(
      raw.height ?? raw.customHeight,
      1,
      16384,
      fallback.height,
    ),
    count: clampInteger(raw.count, 1, 8, fallback.count),
    quality,
    outputFormat,
    backgroundMode,
    ...(mask ? { mask } : {}),
    upscaleScale: clampInteger(
      raw.upscaleScale,
      1,
      4,
      fallback.upscaleScale,
    ) as ImageCreationSettings["upscaleScale"],
    upscaleTarget:
      raw.upscaleTarget === "1K" ||
      raw.upscaleTarget === "2K" ||
      raw.upscaleTarget === "4K"
        ? raw.upscaleTarget
        : "auto",
    upscaleSeed: clampInteger(
      raw.upscaleSeed,
      0,
      2147483647,
      fallback.upscaleSeed,
    ),
    upscaleColorCorrection:
      raw.upscaleColorCorrection === "none" ? "none" : "wavelet",
    upscaleAlgorithm:
      raw.upscaleAlgorithm === "bicubic" || raw.upscaleAlgorithm === "nearest"
        ? raw.upscaleAlgorithm
        : "lanczos",
  };
}

export function normalizeVideoCreationSettings(
  value: unknown,
  runtime?: PublicState | null,
): VideoCreationSettings {
  const raw = objectValue(value);
  const fallback = defaultVideoCreationSettings(runtime);
  const operation =
    raw.operation === "edit" || raw.operation === "extend"
      ? raw.operation
      : "generate";
  const inputMode =
    raw.inputMode === "first-frame" ||
    raw.inputMode === "frames" ||
    raw.inputMode === "reference"
      ? raw.inputMode
      : "text";
  const resolution = String(
    raw.resolution || fallback.resolution,
  ).toLowerCase();
  return {
    kind: "video",
    model: availableModel(runtime, "video", raw.model || raw.modelId),
    operation,
    inputMode,
    duration: clampInteger(
      raw.duration ?? raw.seconds,
      1,
      60,
      fallback.duration,
    ),
    aspect: String(raw.aspect || raw.aspectRatio || fallback.aspect),
    resolution,
    audio: Boolean(raw.audio),
  };
}

export function normalizeAgentCreationSettings(
  value: unknown,
  runtime?: PublicState | null,
): AgentCreationSettings {
  const raw = objectValue(value);
  return {
    kind: "text",
    model: availableModel(runtime, "chat", raw.model || raw.modelId),
    webMode:
      raw.webMode === "always" || raw.webMode === "auto" ? raw.webMode : "off",
  };
}

export function normalizeCreationSettings(
  kind: "image",
  value: unknown,
  runtime?: PublicState | null,
): ImageCreationSettings;
export function normalizeCreationSettings(
  kind: "video",
  value: unknown,
  runtime?: PublicState | null,
): VideoCreationSettings;
export function normalizeCreationSettings(
  kind: "text",
  value: unknown,
  runtime?: PublicState | null,
): AgentCreationSettings;
export function normalizeCreationSettings(
  kind: "image" | "video" | "text",
  value: unknown,
  runtime?: PublicState | null,
): CreationSettings;
export function normalizeCreationSettings(
  kind: "image" | "video" | "text",
  value: unknown,
  runtime?: PublicState | null,
) {
  return kind === "video"
    ? normalizeVideoCreationSettings(value, runtime)
    : kind === "text"
      ? normalizeAgentCreationSettings(value, runtime)
      : normalizeImageCreationSettings(value, runtime);
}

function readStoredDefaults() {
  if (typeof window === "undefined") return {} as Record<string, unknown>;
  try {
    return objectValue(
      JSON.parse(
        window.localStorage.getItem(SHARED_CREATION_SETTINGS_KEY) || "null",
      ),
    );
  } catch {
    return {};
  }
}

function readLegacyImageDefaults() {
  if (typeof window === "undefined") return {};
  try {
    return objectValue(
      JSON.parse(
        window.localStorage.getItem(LEGACY_IMAGE_SETTINGS_KEY) || "null",
      ),
    );
  } catch {
    return {};
  }
}

export function readSharedCreationSettings(
  kind: "image",
  runtime?: PublicState | null,
): ImageCreationSettings;
export function readSharedCreationSettings(
  kind: "video",
  runtime?: PublicState | null,
): VideoCreationSettings;
export function readSharedCreationSettings(
  kind: "text",
  runtime?: PublicState | null,
): AgentCreationSettings;
export function readSharedCreationSettings(
  kind: "image" | "video" | "text",
  runtime?: PublicState | null,
): CreationSettings;
export function readSharedCreationSettings(
  kind: "image" | "video" | "text",
  runtime?: PublicState | null,
) {
  const stored = readStoredDefaults();
  if (kind === "image") {
    const lastCall = getLastModelCall("generate");
    const merged = {
      ...readLegacyImageDefaults(),
      ...(lastCall?.params || {}),
      // Explicit edits in the shared creation dock are the current source of
      // truth. The last-call snapshot is only a fallback for fields that have
      // not been saved in the new defaults yet (notably image count).
      ...objectValue(stored.image),
      model:
        lastCall?.mode === "manual"
          ? objectValue(stored.image).model || lastCall.modelId
          : objectValue(stored.image).model || "auto",
    };
    return normalizeImageCreationSettings(merged, runtime);
  }
  if (kind === "video")
    return normalizeVideoCreationSettings(objectValue(stored.video), runtime);
  return normalizeAgentCreationSettings(objectValue(stored.text), runtime);
}

export function writeSharedCreationSettings(settings: CreationSettings) {
  if (typeof window === "undefined") return;
  const current = readStoredDefaults();
  try {
    window.localStorage.setItem(
      SHARED_CREATION_SETTINGS_KEY,
      JSON.stringify({ ...current, [settings.kind]: settings }),
    );
    if (settings.kind === "image") {
      window.localStorage.setItem(
        LEGACY_IMAGE_SETTINGS_KEY,
        JSON.stringify({
          modelId: settings.model,
          ratio: settings.aspect,
          customRatioWidth: settings.customAspectWidth,
          customRatioHeight: settings.customAspectHeight,
          sizeMode: settings.sizeMode,
          sizeTier: settings.resolution.toLowerCase(),
          count: settings.count,
          quality: settings.quality,
          customWidth: settings.width,
          customHeight: settings.height,
          outputFormat: settings.outputFormat,
          backgroundMode: settings.backgroundMode,
          upscaleScale: settings.upscaleScale,
          upscaleTarget: settings.upscaleTarget,
          upscaleSeed: settings.upscaleSeed,
          upscaleColorCorrection: settings.upscaleColorCorrection,
          upscaleAlgorithm: settings.upscaleAlgorithm,
        }),
      );
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    window.dispatchEvent(new Event("sanmao-workspace-change"));
  } catch {
    /* local settings should never block creation */
  }
}

export function subscribeSharedCreationSettings(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => listener();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function resolveAvailableCreationModel(
  settings: CreationSettings,
  runtime?: PublicState | null,
): { model: RegistryModel | null; unavailableModelId?: string } {
  const candidates =
    settings.kind === "image"
      ? settings.mask
        ? imageEditModelOptions(runtime)
        : imageModelOptions(runtime)
      : settings.kind === "video"
        ? videoModelOptions(runtime)
        : agentModelOptions(runtime);
  if (settings.model === "auto") {
    const defaultModelId = settings.kind === "image"
      ? runtime?.settings.defaultImageModelId
      : settings.kind === "video"
        ? runtime?.settings.defaultVideoModelId
        : runtime?.settings.agentModelId;
    return {
      model: selectAutomaticModel(
        candidates,
        runtime?.settings.defaultProviderId,
        defaultModelId,
      ) || null,
    };
  }
  const selected =
    candidates.find((model) => model.id === settings.model) || null;
  return selected
    ? { model: selected }
    : { model: candidates[0] || null, unavailableModelId: settings.model };
}

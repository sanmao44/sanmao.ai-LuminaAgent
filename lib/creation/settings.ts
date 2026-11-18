import type { PublicState, RegistryModel } from "../types";
import type { ImageModelParameters, ImageOutputFormat } from "@/packages/contracts/creative";
import { parseVideoModelParameterValues, type VideoModelParameterValues } from "@/packages/contracts/video-generation";
import { getLastModelCall } from "../model-preferences";
import { selectAutomaticModel } from "../model-selection";
import { normalizeLocalEditAnnotations, type LocalEditAnnotation } from "../local-edit";
import { getCangyuanImageModelProfile } from "../cangyuan-image-capabilities";
import type { CangyuanImageAdvancedParameter } from "../cangyuan-image-capabilities";
import { isCangyuanProvider } from "../cangyuan-provider";

export type ImageSizeMode = "system" | "custom";
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
  /** A locally composed move guide sent to the provider beside the original source. */
  sourceAssetId?: string;
  sourceUrl?: string;
  moveSourceMaskAssetId?: string;
  moveSourceMaskUrl?: string;
  /** Inline form of the locally composed move guide for non-canvas requests. */
  sourceImageDataUrl?: string;
  referenceId?: string;
  annotations?: LocalEditAnnotation[];
  /** Feather radius in source-image pixels, persisted with the local edit. */
  feather?: number;
};

export type ImageCreationSettings = Omit<ImageModelParameters, "resolution"> & {
  kind: "image";
  model: string;
  aspect: string;
  customAspectWidth: number;
  customAspectHeight: number;
  sizeMode: ImageSizeMode;
  resolution: string;
  width: number;
  height: number;
  count: number;
  quality: "自动" | "auto" | "low" | "medium" | "high" | "xhigh" | "max" | "1" | "4" | "1k" | "2k" | "4k";
  outputFormat: ImageOutputFormat;
  backgroundMode: ImageBackgroundMode;
  mask?: CanvasMaskAsset;
  upscaleScale: 1 | 2 | 3 | 4;
  upscaleTarget: "auto" | "1K" | "2K" | "4K";
  upscaleSeed: number;
  upscaleColorCorrection: "wavelet" | "none";
  upscaleAlgorithm: "lanczos" | "bicubic" | "nearest";
};

export function imageModelParametersFromSettings(settings: ImageCreationSettings): ImageModelParameters {
  const parameters: ImageModelParameters = {
    resolution: settings.resolution,
    tier: settings.tier,
    series: settings.series,
    seed: settings.seed,
    enablePromptExpansion: settings.enablePromptExpansion,
    style: settings.style,
    negativePrompt: settings.negativePrompt,
    layerDecomposition: settings.layerDecomposition,
    layerMaxImages: settings.layerMaxImages,
    layerTextRecognition: settings.layerTextRecognition,
    optimizePrompt: settings.optimizePrompt,
    watermark: settings.watermark,
    safetyIdentifier: settings.safetyIdentifier,
    markupImage: settings.markupImage,
    outputCompression: settings.outputCompression,
    moderation: settings.moderation,
    complexity: settings.complexity,
    frameCount: settings.frameCount,
    frameDurationMs: settings.frameDurationMs,
    svgAuthorModel: settings.svgAuthorModel,
    svgReasoningEffort: settings.svgReasoningEffort,
    chaos: settings.chaos,
    experimentalStyle: settings.experimentalStyle,
    hd: settings.hd,
    referenceImageWeight: settings.referenceImageWeight,
    rawStyle: settings.rawStyle,
    referenceMode: settings.referenceMode,
    referenceSlots: settings.referenceSlots,
    speed: settings.speed,
    stylize: settings.stylize,
    styleWeight: settings.styleWeight,
    weird: settings.weird,
  };
  for (const key of Object.keys(parameters) as Array<keyof ImageModelParameters>) {
    if (parameters[key] === undefined) delete parameters[key];
  }
  return parameters;
}

export type VideoCreationSettings = {
  kind: "video";
  model: string;
  operation: VideoOperation;
  inputMode: VideoInputMode;
  duration: number;
  aspect: string;
  resolution: string;
  audio: boolean;
  agnesWidth: number;
  agnesHeight: number;
  agnesNumFrames: number;
  agnesFrameRate: number;
  modelParameters: VideoModelParameterValues;
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
  "21:9",
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;
export const AGNES_V20_DURATION_PRESETS = [
  { label: "约 3 秒", frames: 81, frameRate: 24 },
  { label: "约 5 秒", frames: 121, frameRate: 24 },
  { label: "约 10 秒", frames: 241, frameRate: 24 },
  { label: "约 18 秒", frames: 441, frameRate: 24 },
] as const;
export const AGNES_V20_DIMENSION_PRESETS = [
  { label: "标准 3:2", width: 1152, height: 768 },
  { label: "横屏 16:9", width: 1024, height: 576 },
  { label: "竖屏 9:16", width: 576, height: 1024 },
  { label: "方形 1:1", width: 768, height: 768 },
] as const;
export const AGNES_V20_DEFAULT_PARAMS = {
  width: 1152,
  height: 768,
  numFrames: 81,
  frameRate: 24,
} as const;
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
    agnesWidth: AGNES_V20_DEFAULT_PARAMS.width,
    agnesHeight: AGNES_V20_DEFAULT_PARAMS.height,
    agnesNumFrames: AGNES_V20_DEFAULT_PARAMS.numFrames,
    agnesFrameRate: AGNES_V20_DEFAULT_PARAMS.frameRate,
    modelParameters: {},
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
  const modelId = availableModel(runtime, "image", raw.model || raw.modelId);
  const model = modelId === "auto"
    ? selectAutomaticModel(
        imageModelOptions(runtime),
        runtime?.settings.defaultProviderId,
        runtime?.settings.defaultImageModelId,
      )
    : runtime?.models.find((candidate) => candidate.id === modelId && candidate.kind === "image");
  const provider = runtime?.providers?.find((candidate) => candidate.id === model?.providerId);
  const isCangyuan = isCangyuanProvider(provider);
  const cangyuanProfile = isCangyuan && model
    ? getCangyuanImageModelProfile(model.rawId)
    : null;
  const imageCountLimit = isCangyuan
    ? cangyuanProfile?.fixedOutputCount ?? Math.min(10, Math.max(1, cangyuanProfile?.nMax ?? 1))
    : 8;
  const aspectCandidate = String(raw.aspect || raw.ratio || fallback.aspect);
  const hasResolutionInput = typeof raw.resolution === "string" || typeof raw.sizeTier === "string";
  const resolutionCandidate = String(
    hasResolutionInput ? raw.resolution || raw.sizeTier : cangyuanProfile?.resolutionDefault || fallback.resolution,
  );
  const cangyuanResolution = cangyuanProfile?.resolutionEnum?.find(
    (candidate) => candidate.toLowerCase() === resolutionCandidate.toLowerCase(),
  );
  const resolution = cangyuanProfile?.resolutionEnum?.length
    ? cangyuanResolution || cangyuanProfile.resolutionDefault || cangyuanProfile.resolutionEnum[0]
    : IMAGE_SIZE_TIERS.find((item) => item.value === resolutionCandidate.toUpperCase())?.value || fallback.resolution;
  const tierCandidate = typeof raw.tier === "string" ? raw.tier.trim() : "";
  const tier = cangyuanProfile?.tierEnum?.find((candidate) => candidate.toLowerCase() === tierCandidate.toLowerCase());
  const seriesCandidate = typeof raw.series === "string" ? raw.series.trim() : "";
  const series = cangyuanProfile?.seriesEnum?.find((candidate) => candidate.toLowerCase() === seriesCandidate.toLowerCase())
    || cangyuanProfile?.seriesDefault
    || cangyuanProfile?.seriesEnum?.[0];
  const seedCandidate = typeof raw.seed === "string" ? raw.seed.trim() : "";
  const seed = cangyuanProfile?.supportsSeed
    && seedCandidate
    && (!cangyuanProfile.seedInteger || /^-?\d+$/.test(seedCandidate))
    ? seedCandidate
    : undefined;
  const enablePromptExpansion = cangyuanProfile?.supportsPromptExpansion
    ? typeof raw.enablePromptExpansion === "boolean"
      ? raw.enablePromptExpansion
      : cangyuanProfile.promptExpansionDefault ?? true
    : undefined;
  const style = cangyuanProfile?.supportsStyle && typeof raw.style === "string" && raw.style.trim()
    ? raw.style.trim()
    : undefined;
  const negativePrompt = (cangyuanProfile?.supportsNegativePrompt || cangyuanProfile?.supportsNoParameter) && typeof raw.negativePrompt === "string" && raw.negativePrompt.trim()
    ? raw.negativePrompt.trim()
    : undefined;
  const layerDecomposition = cangyuanProfile?.supportsLayerDecomposition && typeof raw.layerDecomposition === "boolean"
    ? raw.layerDecomposition
    : undefined;
  const layerMaxImagesCandidate = Number(raw.layerMaxImages);
  const layerMaxImages = layerDecomposition && Number.isInteger(layerMaxImagesCandidate) && layerMaxImagesCandidate >= 2 && layerMaxImagesCandidate <= 100
    ? layerMaxImagesCandidate
    : undefined;
  const layerTextRecognition = layerDecomposition && typeof raw.layerTextRecognition === "boolean"
    ? raw.layerTextRecognition
    : undefined;
  const optimizePrompt = cangyuanProfile?.supportsPromptOptimization && typeof raw.optimizePrompt === "boolean"
    ? raw.optimizePrompt
    : undefined;
  const watermark = cangyuanProfile?.supportsWatermarkSetting && typeof raw.watermark === "boolean"
    ? raw.watermark
    : undefined;
  const safetyIdentifier = cangyuanProfile?.supportsSafetyIdentifier && typeof raw.safetyIdentifier === "string" && raw.safetyIdentifier.trim()
    ? raw.safetyIdentifier.trim()
    : undefined;
  const markupImage = cangyuanProfile?.supportsMarkupImage && typeof raw.markupImage === "string" && raw.markupImage.trim()
    ? raw.markupImage.trim()
    : undefined;
  const supportsAdvanced = (name: CangyuanImageAdvancedParameter) => Boolean(cangyuanProfile?.advancedParameters?.includes(name));
  const advancedNumber = (name: CangyuanImageAdvancedParameter, value: unknown, minimum: number, maximum: number, step = 1) => {
    if (!supportsAdvanced(name) || value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    const stepped = Math.round((parsed - minimum) / step) * step + minimum;
    return Math.max(minimum, Math.min(maximum, Number(stepped.toFixed(2))));
  };
  const outputCompression = advancedNumber("output_compression", raw.outputCompression, 0, 100);
  const moderation = supportsAdvanced("moderation") && (raw.moderation === "auto" || raw.moderation === "low")
    ? raw.moderation
    : undefined;
  const complexity = supportsAdvanced("complexity") && (raw.complexity === "low" || raw.complexity === "medium" || raw.complexity === "high")
    ? raw.complexity
    : undefined;
  const frameCount = advancedNumber("frame_count", raw.frameCount, 2, 16);
  const frameDurationMs = advancedNumber("frame_duration_ms", raw.frameDurationMs, 20, cangyuanProfile?.frameDurationMaximum ?? 2000, 10);
  const chaos = advancedNumber("chaos", raw.chaos, 0, 100);
  const experimentalStyle = advancedNumber("exp", raw.experimentalStyle, 0, 100);
  const hd = supportsAdvanced("hd") && typeof raw.hd === "boolean" ? raw.hd : undefined;
  const referenceImageWeight = advancedNumber("iw", raw.referenceImageWeight, 0, 3, 0.1);
  const rawStyle = supportsAdvanced("raw") && typeof raw.rawStyle === "boolean" ? raw.rawStyle : undefined;
  const referenceModes = ["image", "style", "edit", "moodboard", "editor"] as const;
  const referenceMode = supportsAdvanced("reference") && typeof raw.referenceMode === "string" && referenceModes.includes(raw.referenceMode as (typeof referenceModes)[number])
    ? raw.referenceMode as ImageCreationSettings["referenceMode"]
    : undefined;
  const referenceSlots = advancedNumber("reference_slots", raw.referenceSlots, 1, 8);
  const speed = supportsAdvanced("speed") && (raw.speed === "relax" || raw.speed === "fast") ? raw.speed : undefined;
  const stylize = advancedNumber("stylize", raw.stylize, 0, 1000, 10);
  const styleWeight = advancedNumber("sw", raw.styleWeight, 0, 1000, 10);
  const weird = advancedNumber("weird", raw.weird, 0, 3000, 50);
  const sizeMode = raw.sizeMode === "custom" ? "custom" : "system";
  const outputFormat = !layerDecomposition && (raw.outputFormat === "jpeg" || raw.outputFormat === "webp" || raw.outputFormat === "gif" || raw.outputFormat === "svg")
    ? raw.outputFormat
    : "png";
  const backgroundMode =
    raw.backgroundMode === "api-transparent" ||
    raw.backgroundMode === "local-transparent" ||
    raw.backgroundMode === "opaque"
      ? raw.backgroundMode
      : "auto";
  const qualityValues = ["auto", "low", "medium", "high", "xhigh", "max", "1", "4", "1k", "2k", "4k"] as const;
  const quality = typeof raw.quality === "string" && qualityValues.includes(raw.quality as (typeof qualityValues)[number])
    ? raw.quality as ImageCreationSettings["quality"]
    : "自动";
  const cangyuanSizeValues = new Set([
    ...(cangyuanProfile?.sizeRecommendations || []),
    ...(cangyuanProfile?.aspectRatioRecommendations || []),
    ...(cangyuanProfile?.aspectRatioEnum || []),
  ].map((candidate) => candidate.toLowerCase()));
  const maskRaw = typeof raw.mask === "string"
    ? { url: raw.mask }
    : objectValue(raw.mask);
  const maskAnnotations = normalizeLocalEditAnnotations(maskRaw.annotations);
  const maskFeatherValue = Number(maskRaw.feather);
  const maskFeather = Number.isFinite(maskFeatherValue)
    ? clampInteger(maskFeatherValue, 0, 48, 0)
    : undefined;
  const mask =
    typeof maskRaw.url === "string" && maskRaw.url
      ? {
          url: maskRaw.url,
          ...(typeof maskRaw.assetId === "string"
            ? { assetId: maskRaw.assetId }
            : {}),
          ...(typeof maskRaw.sourceAssetId === "string"
            ? { sourceAssetId: maskRaw.sourceAssetId }
            : {}),
          ...(typeof maskRaw.sourceUrl === "string"
            ? { sourceUrl: maskRaw.sourceUrl }
            : {}),
          ...(typeof maskRaw.moveSourceMaskAssetId === "string"
            ? { moveSourceMaskAssetId: maskRaw.moveSourceMaskAssetId }
            : {}),
          ...(typeof maskRaw.moveSourceMaskUrl === "string"
            ? { moveSourceMaskUrl: maskRaw.moveSourceMaskUrl }
            : {}),
          ...(typeof maskRaw.sourceImageDataUrl === "string"
            ? { sourceImageDataUrl: maskRaw.sourceImageDataUrl }
            : {}),
          ...(typeof maskRaw.referenceId === "string"
            ? { referenceId: maskRaw.referenceId }
            : {}),
          ...(maskAnnotations.length
            ? { annotations: maskAnnotations }
            : {}),
          ...(maskFeather !== undefined ? { feather: maskFeather } : {}),
        }
      : undefined;
  return {
    kind: "image",
    model: modelId,
    aspect: IMAGE_RATIOS.includes(
      aspectCandidate as (typeof IMAGE_RATIOS)[number],
    ) || (isCangyuan && cangyuanSizeValues.has(aspectCandidate.toLowerCase()))
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
    ...(tier ? { tier } : {}),
    ...(series ? { series } : {}),
    ...(seed ? { seed } : {}),
    ...(enablePromptExpansion !== undefined ? { enablePromptExpansion } : {}),
    ...(style ? { style } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(layerDecomposition !== undefined ? { layerDecomposition } : {}),
    ...(layerMaxImages !== undefined ? { layerMaxImages } : {}),
    ...(layerTextRecognition !== undefined ? { layerTextRecognition } : {}),
    ...(optimizePrompt !== undefined ? { optimizePrompt } : {}),
    ...(watermark !== undefined ? { watermark } : {}),
    ...(safetyIdentifier ? { safetyIdentifier } : {}),
    ...(markupImage ? { markupImage } : {}),
    ...(outputCompression !== undefined && (outputFormat === "jpeg" || outputFormat === "webp") ? { outputCompression } : {}),
    ...(moderation ? { moderation } : {}),
    ...(complexity ? { complexity } : {}),
    ...(frameCount !== undefined && outputFormat === "gif" ? { frameCount } : {}),
    ...(frameDurationMs !== undefined && outputFormat === "gif" ? { frameDurationMs } : {}),
    ...(outputFormat === "svg" && cangyuanProfile?.supportsSvgOptions && typeof raw.svgAuthorModel === "string" && raw.svgAuthorModel.trim()
      ? { svgAuthorModel: raw.svgAuthorModel.trim() } : {}),
    ...(outputFormat === "svg" && cangyuanProfile?.supportsSvgOptions
      && (raw.svgReasoningEffort === "none" || raw.svgReasoningEffort === "minimal" || raw.svgReasoningEffort === "low"
        || raw.svgReasoningEffort === "medium" || raw.svgReasoningEffort === "high" || raw.svgReasoningEffort === "xhigh" || raw.svgReasoningEffort === "max")
      ? { svgReasoningEffort: raw.svgReasoningEffort } : {}),
    ...(chaos !== undefined ? { chaos } : {}),
    ...(experimentalStyle !== undefined ? { experimentalStyle } : {}),
    ...(hd !== undefined ? { hd } : {}),
    ...(referenceImageWeight !== undefined ? { referenceImageWeight } : {}),
    ...(rawStyle !== undefined ? { rawStyle } : {}),
    ...(referenceMode ? { referenceMode } : {}),
    ...(referenceSlots !== undefined ? { referenceSlots } : {}),
    ...(speed ? { speed } : {}),
    ...(stylize !== undefined ? { stylize } : {}),
    ...(styleWeight !== undefined ? { styleWeight } : {}),
    ...(weird !== undefined ? { weird } : {}),
    width: clampInteger(raw.width ?? raw.customWidth, 1, 16384, fallback.width),
    height: clampInteger(
      raw.height ?? raw.customHeight,
      1,
      16384,
      fallback.height,
    ),
    count: clampInteger(raw.count, 1, imageCountLimit, fallback.count),
    quality,
    outputFormat,
    backgroundMode: layerDecomposition && backgroundMode === "api-transparent" ? "auto" : backgroundMode,
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
  const normalizeAgnesDimension = (value: unknown, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(64, Math.min(3840, Math.round(parsed / 64) * 64));
  };
  const normalizeAgnesFrames = (value: unknown, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackValue;
    const clamped = Math.max(1, Math.min(441, Math.round(parsed)));
    return Math.max(1, Math.min(441, Math.round((clamped - 1) / 8) * 8 + 1));
  };
  let modelParameters: VideoModelParameterValues = {};
  try {
    modelParameters = parseVideoModelParameterValues(raw.modelParameters);
  } catch {
    modelParameters = {};
  }
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
    agnesWidth: normalizeAgnesDimension(raw.agnesWidth, fallback.agnesWidth),
    agnesHeight: normalizeAgnesDimension(raw.agnesHeight, fallback.agnesHeight),
    agnesNumFrames: normalizeAgnesFrames(raw.agnesNumFrames, fallback.agnesNumFrames),
    agnesFrameRate: clampInteger(
      raw.agnesFrameRate,
      1,
      60,
      fallback.agnesFrameRate,
    ),
    modelParameters,
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

/**
 * A local-edit mask belongs to one image/node, never to the shared image
 * defaults. Keep this boundary in one place so a completed local edit cannot
 * become the selection for every subsequently imported image.
 */
function imageDefaultsWithoutMask(value: unknown) {
  const { mask: _mask, ...defaults } = objectValue(value);
  return defaults;
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
      ...imageDefaultsWithoutMask(lastCall?.params),
      // Explicit edits in the shared creation dock are the current source of
      // truth. The last-call snapshot is only a fallback for fields that have
      // not been saved in the new defaults yet (notably image count).
      ...imageDefaultsWithoutMask(stored.image),
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
    const persistedSettings = settings.kind === "image"
      ? imageDefaultsWithoutMask(settings)
      : settings;
    window.localStorage.setItem(
      SHARED_CREATION_SETTINGS_KEY,
      JSON.stringify({ ...current, [settings.kind]: persistedSettings }),
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

export function imageModelIdForRequest(settings: ImageCreationSettings) {
  return settings.model === "auto" ? "auto" : settings.model;
}

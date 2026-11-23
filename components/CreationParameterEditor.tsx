"use client";

import { useEffect, useMemo, useState } from "react";
import ModelPicker from "./ModelPicker";
import SelectMenu from "./SelectMenu";
import EditableSuggestionField from "./EditableSuggestionField";
import VideoDurationField from "./VideoDurationField";
import CangyuanImageModelOptions from "@/components/cangyuan/CangyuanImageModelOptions";
import CangyuanVideoModelParameters from "@/components/cangyuan/CangyuanVideoModelParameters";
import {
  IMAGE_QUALITY_OPTIONS,
  IMAGE_RATIOS,
  IMAGE_SIZE_TIERS,
  VIDEO_RATIOS,
  AGNES_V20_DIMENSION_PRESETS,
  AGNES_V20_DURATION_PRESETS,
  type CreationSettings,
  type AgentCreationSettings,
  type ImageCreationSettings,
  type VideoCreationSettings,
  type VideoInputMode,
} from "@/lib/creation/settings";
import { normalizeImageCreationSettings, resolveAvailableCreationModel } from "@/lib/creation/settings";
import { getCangyuanImageModelProfile } from "@/lib/cangyuan-image-capabilities";
import { isCangyuanProvider, usesCangyuanVideoProtocol } from "@/lib/cangyuan-provider";
import { getCangyuanVideoModelProfile } from "@/lib/cangyuan-video-capabilities";
import {
  cangyuanVideoParameterValueLabel,
  getCangyuanVideoAdvancedParameters,
  getCangyuanVideoModelSpec,
  getCangyuanVideoParameter,
} from "@/lib/cangyuan-video-model-catalog";
import type { CangyuanVideoModelSpec, VideoModelParameterValues } from "@/packages/contracts/video-generation";
import { getVideoModelLimitsForInput, type VideoModelInputContext } from "@/lib/video-model-limits";
import { is65535Provider } from "@/lib/video-platform";
import type { ModelCapability, PublicState } from "@/lib/types";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";

type Props = {
  settings: CreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  referenceCount?: number;
  videoModelInput?: VideoModelInputContext;
  modelCapabilities?: readonly ModelCapability[];
  variant?: "default" | "canvas-flat" | "dock";
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  onChange: (settings: CreationSettings) => void;
  /** Called only when a user explicitly picks a video input mode. */
  onVideoInputModeChange?: (mode: VideoInputMode) => void;
};

const ratioDescriptions: Record<string, string> = {
  自动: "单图匹配参考图，多图交给模型",
  auto: "由视频模型自动选择",
  "1:1": "方形",
  "16:9": "宽屏",
  "9:16": "竖屏",
  "4:3": "横向",
  "3:4": "纵向",
  "3:2": "相机横幅",
  "2:3": "相机竖幅",
  "5:4": "横向海报",
  "4:5": "竖向海报",
  "2:1": "全景",
  "1:2": "长竖图",
  "21:9": "超宽屏",
  "9:21": "超长竖屏",
  自定义: "输入宽高比例",
};

function ImageEditor({
  settings,
  runtime,
  unavailableModelId,
  referenceCount = 0,
  modelCapabilities,
  variant,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
  onChange,
}: {
  settings: ImageCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  referenceCount?: number;
  modelCapabilities?: readonly ModelCapability[];
  variant?: Props["variant"];
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  onChange: Props["onChange"];
}) {
  const [advanced, setAdvanced] = useState(false);
  const flat = variant === "canvas-flat";
  const dock = variant === "dock";
  const dockQualityLabel = (label: string) =>
    label === "自动质量" ? "自动"
    : label === "低质量" ? "低画质"
    : label === "中等质量" ? "标准画质"
    : label === "高质量" ? "高画质"
    : label.replace("质量", "");
  const [parameterDrawerOpen, setParameterDrawerOpen] = useState(false);
  useEffect(() => {
    if (!parameterDrawerOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setParameterDrawerOpen(false);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [parameterDrawerOpen]);
  const update = <K extends keyof ImageCreationSettings>(
    key: K,
    value: ImageCreationSettings[K],
  ) => onChange({ ...settings, [key]: value });
  const models = runtime?.models || [];
  const defaultProvider = runtime?.providers.find(
    (item) => item.id === runtime.settings.defaultProviderId,
  );
  const selectedModel = resolveAvailableCreationModel(settings, runtime).model;
  const selectedProvider = runtime?.providers.find((item) => item.id === selectedModel?.providerId);
  const usesCangyuan = isCangyuanProvider(selectedProvider);
  const cangyuanProfile = usesCangyuan && selectedModel
    ? getCangyuanImageModelProfile(selectedModel.rawId)
    : null;
  const cangyuanResolutionOptions = cangyuanProfile?.resolutionEnum || [];
  const cangyuanTierOptions = cangyuanProfile?.tierEnum || [];
  const cangyuanSeriesOptions = cangyuanProfile?.seriesEnum || [];
  const cangyuanSizeSuggestions = (cangyuanProfile?.sizeRecommendations || []).filter((value) =>
    (value.toLowerCase() === "auto" || /^(?:\d+:\d+(?:-max)?|\d+(?:\.\d+)?k|\d+x\d+)$/i.test(value))
      && (!cangyuanProfile?.supportsAspectRatio || !/^\d+:\d+$/.test(value)),
  );
  const cangyuanAspectSize = cangyuanSizeSuggestions.find((value) => value.toLowerCase() === settings.aspect.toLowerCase());
  const cangyuanResolutionSize = cangyuanSizeSuggestions.find((value) => value.toLowerCase() === settings.resolution.toLowerCase());
  const hasNonDefaultCangyuanAspect = settings.aspect !== "1:1" && Boolean(cangyuanAspectSize);
  const hasNonDefaultCangyuanResolution = settings.resolution !== "1K" && Boolean(cangyuanResolutionSize);
  const requestedCangyuanSize = (settings.sizeMode === "custom"
    ? `${settings.width}x${settings.height}`
    : cangyuanProfile?.supportsAspectRatio
      ? settings.resolution
      : hasNonDefaultCangyuanAspect
        ? cangyuanAspectSize
        : hasNonDefaultCangyuanResolution
          ? cangyuanResolutionSize
          : cangyuanAspectSize || cangyuanResolutionSize || settings.aspect) || "1:1";
  const cangyuanSizeValue = cangyuanSizeSuggestions.includes(requestedCangyuanSize)
    ? requestedCangyuanSize
    : cangyuanSizeSuggestions.find((value) => value.toLowerCase() === "auto") || cangyuanSizeSuggestions[0] || "";
  const imageRatioOptions = usesCangyuan
    ? ["自动", ...(cangyuanProfile?.supportsAspectRatio ? cangyuanProfile.aspectRatioRecommendations : [])]
    : [...IMAGE_RATIOS];
  const imageSizeOptions = usesCangyuan
    ? IMAGE_SIZE_TIERS.filter((item) => cangyuanProfile?.sizeRecommendations.includes(item.value))
    : [...IMAGE_SIZE_TIERS];
  const imageQualityOptions = usesCangyuan
    ? (cangyuanProfile?.qualityEnum || []).map((value) => ({
        value: (value === "auto" ? "自动" : value) as ImageCreationSettings["quality"],
        label: value === "auto" ? "自动" : value.toUpperCase(),
        description: "沧元算力模型文档支持的质量参数",
      }))
    : IMAGE_QUALITY_OPTIONS;
  const imageFormatOptions = usesCangyuan
    ? (cangyuanProfile?.outputFormatEnum || []).map((value) => ({
        value: value as ImageCreationSettings["outputFormat"],
        label: value.toUpperCase(),
      }))
    : [
        { value: "png" as const, label: "PNG · 无损" },
        { value: "jpeg" as const, label: "JPEG · 体积更小" },
        { value: "webp" as const, label: "WebP · 适合网页" },
      ];
  const imageBackgroundOptions = usesCangyuan
    ? [
        { value: "auto" as const, label: "模型默认" },
        ...(cangyuanProfile?.backgroundEnum.includes("transparent") && !settings.layerDecomposition ? [{ value: "api-transparent" as const, label: "API 透明" }] : []),
        { value: "local-transparent" as const, label: "本地透明", description: "自动去白底并输出 PNG" },
        ...(cangyuanProfile?.backgroundEnum.includes("opaque") ? [{ value: "opaque" as const, label: "不透明" }] : []),
      ]
    : [
        { value: "auto" as const, label: "自动" },
        { value: "api-transparent" as const, label: "API 透明", description: "仅支持部分模型" },
        { value: "local-transparent" as const, label: "本地透明", description: "自动去白底并输出 PNG" },
        { value: "opaque" as const, label: "不透明" },
      ];
  const imageCountLimit = usesCangyuan
    ? cangyuanProfile?.fixedOutputCount ?? Math.min(10, Math.max(1, cangyuanProfile?.nMax ?? 1))
    : 8;
  const imageCountOptions = cangyuanProfile?.fixedOutputCount
    ? [cangyuanProfile.fixedOutputCount]
    : Array.from({ length: imageCountLimit }, (_, index) => index + 1);
  const selectedImageCount = imageCountOptions.includes(settings.count) ? settings.count : imageCountOptions[0] || 1;
  const referenceLimitExceeded = Boolean(cangyuanProfile?.imagesMaxItems && referenceCount > cangyuanProfile.imagesMaxItems);
  const withCangyuanSize = (
    base: ImageCreationSettings,
    value: string,
    profile = cangyuanProfile,
  ): ImageCreationSettings => {
    const defaultResolution = profile?.resolutionEnum?.length ? base.resolution : "1K";
    if (value.toLowerCase() === "auto") return { ...base, sizeMode: "system", aspect: "自动", resolution: defaultResolution };
    if (/^\d+:\d+$/.test(value)) return { ...base, sizeMode: "system", aspect: value, resolution: defaultResolution };
    const dimensions = /^(\d+)x(\d+)$/i.exec(value);
    if (dimensions) return { ...base, sizeMode: "custom", width: Number(dimensions[1]), height: Number(dimensions[2]) };
    const sizeTier = IMAGE_SIZE_TIERS.find((item) => item.value.toLowerCase() === value.toLowerCase());
    if (sizeTier) return { ...base, sizeMode: "system", aspect: "1:1", resolution: sizeTier.value };
    return { ...base, sizeMode: "system", aspect: value, resolution: defaultResolution };
  };
  const applyCangyuanSize = (value: string) => {
    onChange(withCangyuanSize(settings, value));
  };
  const updateImageBackground = (backgroundMode: ImageCreationSettings["backgroundMode"]) => {
    const needsPng = backgroundMode === "api-transparent" || backgroundMode === "local-transparent";
    const supportsPng = imageFormatOptions.some((option) => option.value === "png");
    onChange({
      ...settings,
      backgroundMode,
      ...(needsPng && supportsPng ? { outputFormat: "png" as const } : {}),
    });
  };
  const updateImageOutputFormat = (value: string) => {
    const outputFormat = value as ImageCreationSettings["outputFormat"];
    onChange({
      ...settings,
      outputFormat,
      ...(outputFormat === "svg" ? { count: 1 } : {}),
      ...(outputFormat === "svg" || outputFormat === "gif" || outputFormat === "png"
        ? { outputCompression: undefined }
        : {}),
    });
  };
  const updateImageModel = (modelId: string) => {
    const nextSettings = { ...settings, model: modelId };
    const nextModel = resolveAvailableCreationModel(nextSettings, runtime).model;
    const nextProvider = runtime?.providers.find((item) => item.id === nextModel?.providerId);
    if (isCangyuanProvider(nextProvider)) {
      const profile = nextModel ? getCangyuanImageModelProfile(nextModel.rawId) : null;
      const options = profile?.sizeRecommendations.filter((value) =>
        value.toLowerCase() === "auto" || /^(?:\d+:\d+(?:-max)?|\d+(?:\.\d+)?k|\d+x\d+)$/i.test(value),
      ) || [];
      const currentSize = settings.sizeMode === "custom"
        ? `${settings.width}x${settings.height}`
        : settings.aspect !== "1:1" && options.some((value) => value.toLowerCase() === settings.aspect.toLowerCase())
          ? settings.aspect
          : settings.resolution !== "1K" && options.some((value) => value.toLowerCase() === settings.resolution.toLowerCase())
            ? settings.resolution
            : settings.aspect;
      const selectedSize = options.find((value) => value.toLowerCase() === currentSize.toLowerCase()) || options[0];
      const countLimit = profile?.fixedOutputCount ?? Math.min(10, Math.max(1, profile?.nMax ?? 1));
      const nextModelSettings = {
        ...nextSettings,
        count: Math.min(settings.count, countLimit),
        resolution: profile?.resolutionEnum?.find((value) => value.toLowerCase() === settings.resolution.toLowerCase())
          || profile?.resolutionDefault
          || settings.resolution,
        tier: profile?.tierEnum?.find((value) => value.toLowerCase() === settings.tier?.toLowerCase()),
        series: profile?.seriesEnum?.find((value) => value.toLowerCase() === settings.series?.toLowerCase())
          || profile?.seriesDefault,
        seed: profile?.supportsSeed ? settings.seed : undefined,
        enablePromptExpansion: profile?.supportsPromptExpansion
          ? settings.enablePromptExpansion ?? profile.promptExpansionDefault ?? true
          : undefined,
        style: profile?.supportsStyle ? settings.style : undefined,
        negativePrompt: profile?.supportsNegativePrompt || profile?.supportsNoParameter ? settings.negativePrompt : undefined,
        layerDecomposition: profile?.supportsLayerDecomposition ? settings.layerDecomposition : undefined,
        layerMaxImages: profile?.supportsLayerDecomposition ? settings.layerMaxImages : undefined,
        layerTextRecognition: profile?.supportsLayerDecomposition ? settings.layerTextRecognition : undefined,
        optimizePrompt: profile?.supportsPromptOptimization ? settings.optimizePrompt : undefined,
        watermark: profile?.supportsWatermarkSetting ? settings.watermark : undefined,
        safetyIdentifier: profile?.supportsSafetyIdentifier ? settings.safetyIdentifier : undefined,
        markupImage: profile?.supportsMarkupImage ? settings.markupImage : undefined,
        quality: profile?.qualityEnum.includes(settings.quality) ? settings.quality : "自动",
        outputFormat: profile?.outputFormatEnum.includes(settings.outputFormat) ? settings.outputFormat : "png",
        backgroundMode: settings.backgroundMode === "api-transparent" && !profile?.backgroundEnum.includes("transparent")
          || settings.backgroundMode === "opaque" && !profile?.backgroundEnum.includes("opaque")
          ? "auto"
          : settings.backgroundMode,
      };
      onChange(normalizeImageCreationSettings(
        selectedSize ? withCangyuanSize(nextModelSettings, selectedSize, profile) : nextModelSettings,
        runtime,
      ));
      return;
    }
    onChange(normalizeImageCreationSettings({
      ...nextSettings,
      count: Math.min(settings.count, 8),
      quality: IMAGE_QUALITY_OPTIONS.some((option) => option.value === settings.quality) ? settings.quality : "自动",
      outputFormat: ["png", "jpeg", "webp"].includes(settings.outputFormat) ? settings.outputFormat : "png",
      backgroundMode: settings.backgroundMode === "api-transparent" ? "auto" : settings.backgroundMode,
      tier: undefined,
      series: undefined,
      seed: undefined,
      enablePromptExpansion: undefined,
      style: undefined,
      negativePrompt: undefined,
      layerDecomposition: undefined,
      layerMaxImages: undefined,
      layerTextRecognition: undefined,
      optimizePrompt: undefined,
      watermark: undefined,
      safetyIdentifier: undefined,
      markupImage: undefined,
    }, runtime));
  };
  const cangyuanSizeSelect = cangyuanSizeSuggestions.length > 0 ? (
    <SelectMenu
      portalZIndex={portalZIndex}
      value={cangyuanSizeValue}
      onChange={applyCangyuanSize}
      options={cangyuanSizeSuggestions.map((value) => ({
        value,
        label: value.toLowerCase() === "auto" ? "自动" : value.replace("x", " × "),
        description: "沧元算力模型文档中的建议尺寸",
      }))}
      ariaLabel="沧元模型建议尺寸"
    />
  ) : null;
  const cangyuanResolutionSelect = cangyuanResolutionOptions.length ? (
    <SelectMenu
      portalZIndex={portalZIndex}
      value={cangyuanResolutionOptions.includes(settings.resolution) ? settings.resolution : cangyuanProfile?.resolutionDefault || cangyuanResolutionOptions[0]}
      onChange={(value) => update("resolution", value)}
      options={cangyuanResolutionOptions.map((value) => ({
        value,
        label: value.toLowerCase() === "768sq" ? "方形 768" : value.toUpperCase(),
        description: value.toLowerCase() === "768sq" ? "适用于小尺寸方图输出" : `模型支持的清晰度：${value}`,
      }))}
      ariaLabel="模型清晰度"
    />
  ) : null;
  const cangyuanTierSelect = cangyuanTierOptions.length ? (
    <SelectMenu
      portalZIndex={portalZIndex}
      value={cangyuanTierOptions.includes(settings.tier || "") ? settings.tier || "" : ""}
      onChange={(value) => update("tier", value || undefined)}
      options={[
        { value: "", label: "模型默认" },
        ...cangyuanTierOptions.map((value) => ({
          value,
          label: value === "web" ? "网页档位" : value.toUpperCase(),
          description: "按所选生成档位计费",
        })),
      ]}
      ariaLabel="输出档位"
    />
  ) : null;
  const cangyuanSeriesSelect = cangyuanSeriesOptions.length ? (
    <SelectMenu
      portalZIndex={portalZIndex}
      value={cangyuanSeriesOptions.includes(settings.series || "") ? settings.series || "" : cangyuanProfile?.seriesDefault || cangyuanSeriesOptions[0]}
      onChange={(value) => update("series", value)}
      options={cangyuanSeriesOptions.map((value) => ({
        value,
        label: value === "flare" ? "Flare 系列（光耀）" : value === "sunburst" ? "Sunburst 系列（日芒）" : value,
        description: "模型官方系列选项",
      }))}
      ariaLabel="图片系列"
    />
  ) : null;
  const cangyuanVariantField = cangyuanProfile?.variantEnum?.length ? (
    <label className="creation-field compact">
      <small>生成模式</small>
      <SelectMenu
        portalZIndex={portalZIndex}
        value={cangyuanProfile.variantEnum.includes(settings.variant || "")
          ? settings.variant || ""
          : cangyuanProfile.variantDefault || cangyuanProfile.variantEnum[0]}
        onChange={(value) => update("variant", value as ImageCreationSettings["variant"])}
        options={cangyuanProfile.variantEnum.map((value) => ({
          value,
          label: value === "standard" ? "标准" : value === "highspeed" ? "高速" : value,
          description: value === "standard" ? "标准生成速度" : "高速生成模式",
        }))}
        ariaLabel="图片生成模式"
      />
    </label>
  ) : null;
  const cangyuanPromptExpansionControl = cangyuanProfile?.supportsPromptExpansion ? (
    <label className="creation-field creation-toggle">
      <small>提示词扩写</small>
      <button
        type="button"
        className={settings.enablePromptExpansion ? "active" : ""}
        aria-pressed={Boolean(settings.enablePromptExpansion)}
        title="开启后由模型补充提示词细节；关闭则严格按原提示词生成"
        onClick={() => update("enablePromptExpansion", !settings.enablePromptExpansion)}
      >
        <span>{settings.enablePromptExpansion ? "自动优化" : "按原文"}</span>
        <i />
      </button>
    </label>
  ) : null;
  const cangyuanSeedField = cangyuanProfile?.supportsSeed ? (
    <label className="creation-field">
      <small>固定随机种子</small>
      <input
        className="creation-field-input"
        type="text"
        value={settings.seed || ""}
        onChange={(event) => update("seed", event.target.value.trim() || undefined)}
        placeholder={cangyuanProfile?.seedInteger ? "输入整数；留空随机" : "留空随机"}
        inputMode={cangyuanProfile?.seedInteger ? "numeric" : undefined}
        pattern={cangyuanProfile?.seedInteger ? "-?[0-9]+" : undefined}
        autoComplete="off"
        title={cangyuanProfile?.seedInteger ? "请输入整数；留空时使用随机结果" : "留空时使用随机结果；填写后便于复现"}
      />
    </label>
  ) : null;
  const qualityLabel = IMAGE_QUALITY_OPTIONS.find(
    (option) => option.value === settings.quality,
  )?.label.replace("质量", "") || settings.quality;
  const sizeLabel = usesCangyuan
    ? requestedCangyuanSize
    : settings.sizeMode === "system"
    ? settings.resolution
    : `${settings.width}×${settings.height}`;
  const parameterSummary = `${settings.aspect} · ${qualityLabel} · ${sizeLabel} · ${settings.count} 张`;
  const cangyuanWarnings: string[] = [];
  if (usesCangyuan) {
    if (!cangyuanProfile) cangyuanWarnings.push("该模型未登记在官方能力清单中，当前仅能确认基础提示词请求；请改用已登记模型，或先恢复默认参数。");
    else {
      if (!cangyuanProfile.fixedOutputCount && settings.count > (cangyuanProfile.nMax || 1)) cangyuanWarnings.push(`该模型最多生成 ${cangyuanProfile.nMax || 1} 张，请调整生成数量。`);
      if (cangyuanProfile.fixedOutputCount && settings.count !== cangyuanProfile.fixedOutputCount) cangyuanWarnings.push(`该模型每次任务固定生成 ${cangyuanProfile.fixedOutputCount} 张。`);
      if (settings.mask && !cangyuanProfile.supportsMask) cangyuanWarnings.push("该模型不支持蒙版编辑，请移除蒙版或切换支持编辑的模型。");
      if (referenceLimitExceeded) cangyuanWarnings.push(`该模型最多接收 ${cangyuanProfile.imagesMaxItems} 张参考图。`);
      if ((settings.quality !== "自动" && settings.quality !== "auto" && !cangyuanProfile.qualityEnum.includes(settings.quality))
        || (cangyuanProfile.qualityEnum.length > 0 && settings.quality === "自动" && !cangyuanProfile.qualityEnum.includes("auto"))) {
        cangyuanWarnings.push("当前质量值不受所选模型支持，请选择文档列出的质量值。");
      }
      if (!cangyuanProfile.outputFormatEnum.includes(settings.outputFormat)
        && (settings.outputFormat !== "png" || cangyuanProfile.outputFormatEnum.length > 0)) {
        cangyuanWarnings.push("当前输出格式不受所选模型支持，请选择文档列出的格式。");
      }
      if (settings.backgroundMode === "api-transparent" && !cangyuanProfile.backgroundEnum.includes("transparent")) cangyuanWarnings.push("该模型不支持 API 透明背景；可改用本地透明处理。");
      if (settings.layerDecomposition && referenceCount !== 1) cangyuanWarnings.push("分层输出需要恰好一张参考图片，请只保留一张需要拆层的图片。");
      if (settings.layerDecomposition && settings.backgroundMode === "api-transparent") cangyuanWarnings.push("分层输出不能与 API 透明背景同时使用。");
      if (settings.outputFormat === "svg" && settings.mask) cangyuanWarnings.push("SVG 仅支持文生图，不支持蒙版或改图；请移除蒙版或改用 PNG。");
      if (settings.markupImage && referenceCount < 1) cangyuanWarnings.push("透明标记图需要至少 1 张参考图。");
      if (settings.markupImage && settings.mask) cangyuanWarnings.push("透明标记图不能与蒙版同时使用。");
      if (settings.backgroundMode === "opaque" && !cangyuanProfile.backgroundEnum.includes("opaque")) cangyuanWarnings.push("该模型不支持指定不透明背景，请改用自动背景。");
      if (cangyuanSizeSuggestions.length && !cangyuanSizeSuggestions.some((value) => value.toLowerCase() === requestedCangyuanSize.toLowerCase())
        && !(settings.sizeMode === "system" && settings.aspect === "1:1" && settings.resolution === "1K")) {
        cangyuanWarnings.push("当前尺寸不在模型文档的推荐值中，请选择一个模型建议尺寸。");
      }
    }
  }
  return (
    <div className={`creation-parameter-editor image${flat ? " canvas-flat" : ""}${dock ? " canvas-dock" : ""}`}>
      {unavailableModelId && (
        <div className="creation-model-warning">
          <b>原模型当前不可用</b>
          <span>
            {unavailableModelId}{" "}
            将在重新生成时回退到自动模型，历史快照仍会保留。
          </span>
        </div>
      )}
      {usesCangyuan && (
        <div className={`creation-model-warning${cangyuanWarnings.length ? " warning" : ""}`}>
          <b>{cangyuanWarnings.length ? "沧元模型参数提示" : "沧元模型参数"}</b>
          <span>
            {cangyuanProfile
              ? `${cangyuanProfile.fixedOutputCount ? `每次固定 ${cangyuanProfile.fixedOutputCount} 张` : `单次最多 ${cangyuanProfile.nMax || 1} 张`} · 参考图最多 ${cangyuanProfile.imagesMaxItems ?? "未注明"} 张 · ${cangyuanProfile.supportsMask ? "支持蒙版" : "不支持蒙版"}`
              : "仅发送文档可确认的基础字段；此模型的专属参数能力尚未登记。"}
            {cangyuanWarnings.length > 0 && ` ${cangyuanWarnings.join(" ")}`}
          </span>
        </div>
      )}
      {dock ? (
        <div className="canvas-parameter-groups">
          {imageQualityOptions.length > 0 && <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">画质</span>
            <div className="canvas-parameter-options quality" role="group" aria-label="图片质量">
              {imageQualityOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={settings.quality === option.value ? "active" : ""}
                  aria-pressed={settings.quality === option.value}
                  title={option.description}
                  onClick={() => update("quality", option.value)}
                >
                  {dockQualityLabel(option.label)}
                </button>
              ))}
            </div>
          </div>}
          {usesCangyuan ? (
            <div className="canvas-parameter-group">
              <span className="canvas-parameter-group-label">模型建议尺寸</span>
              {cangyuanSizeSelect || <small>文档未列出建议尺寸，使用模型默认值</small>}
            </div>
          ) : settings.sizeMode === "system" ? (
            <div className="canvas-parameter-group">
              <span className="canvas-parameter-group-label">清晰度</span>
              <div className="canvas-parameter-options resolution" role="group" aria-label="图片分辨率">
                {imageSizeOptions.map((item) => (
                  <button type="button" key={item.value} className={settings.resolution === item.value ? "active" : ""} aria-pressed={settings.resolution === item.value} title={`长边约 ${item.longEdge}px`} onClick={() => update("resolution", item.value)}>{item.label}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="canvas-parameter-group">
              <span className="canvas-parameter-group-label">自定义尺寸</span>
              <div className="creation-pixel-fields canvas-parameter-pixels">
                <label><small>宽度</small><input type="number" min={1} max={16384} value={settings.width} onChange={(event) => update("width", Math.max(1, Number(event.target.value) || 1))} /></label>
                <b>×</b>
                <label><small>高度</small><input type="number" min={1} max={16384} value={settings.height} onChange={(event) => update("height", Math.max(1, Number(event.target.value) || 1))} /></label>
              </div>
            </div>
          )}
          {cangyuanResolutionSelect && <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">输出清晰度</span>
            {cangyuanResolutionSelect}
          </div>}
          {(!usesCangyuan || cangyuanProfile?.supportsAspectRatio) && <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">比例</span>
            <div className="canvas-parameter-options aspect" role="group" aria-label="图片比例">
              {imageRatioOptions.map((value) => (
                <button type="button" key={value} className={settings.aspect === value ? "active" : ""} aria-pressed={settings.aspect === value} data-ratio={value} title={ratioDescriptions[value]} onClick={() => update("aspect", value)}>
                  <i className="canvas-parameter-ratio-icon" aria-hidden="true" />
                  <span>{value === "自动" ? "自动" : value}</span>
                </button>
              ))}
            </div>
          </div>}
          {!usesCangyuan && settings.aspect === "自定义" && (
            <div className="creation-custom-ratio canvas-parameter-custom-ratio">
              <span>自定义比例</span>
              <input type="number" min={1} value={settings.customAspectWidth} onChange={(event) => update("customAspectWidth", Math.max(1, Number(event.target.value) || 1))} />
              <b>:</b>
              <input type="number" min={1} value={settings.customAspectHeight} onChange={(event) => update("customAspectHeight", Math.max(1, Number(event.target.value) || 1))} />
            </div>
          )}
          <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">生成数量</span>
            <div className="canvas-parameter-options count" role="group" aria-label="生成数量">
              {imageCountOptions.map((value) => (
                <button type="button" key={value} className={selectedImageCount === value ? "active" : ""} aria-pressed={selectedImageCount === value} onClick={() => update("count", value)}>{value} 张</button>
              ))}
            </div>
          </div>
          {cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">生成系列</span>
            {cangyuanSeriesSelect}
          </div>}
          {cangyuanVariantField}
          <button
            type="button"
            className={`creation-advanced-toggle ${advanced ? "active" : ""}`}
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            title={advanced ? "收起尺寸、格式与背景参数" : "展开尺寸、格式与背景参数"}
          >
            <span>{advanced ? "收起更多参数" : "更多参数"}</span>
            <small>尺寸 · 格式与背景</small>
            <b>{advanced ? "⌃" : "⌄"}</b>
          </button>
          {advanced && (
            <div className="creation-parameter-grid advanced canvas-parameter-extra-grid">
              {cangyuanTierSelect && <label className="creation-field">
                <small>生成档位</small>
                {cangyuanTierSelect}
              </label>}
              {!cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <label className="creation-field">
                <small>生成系列</small>
                {cangyuanSeriesSelect}
              </label>}
              {cangyuanPromptExpansionControl}
              {cangyuanSeedField}
              {!usesCangyuan && <div className="canvas-parameter-group">
                <span className="canvas-parameter-group-label">尺寸方式</span>
                <div className="canvas-parameter-options size-mode" role="group" aria-label="图片尺寸方式">
                  <button type="button" className={settings.sizeMode === "system" ? "active" : ""} aria-pressed={settings.sizeMode === "system"} onClick={() => update("sizeMode", "system")}>标准尺寸</button>
                  <button type="button" className={settings.sizeMode === "custom" ? "active" : ""} aria-pressed={settings.sizeMode === "custom"} onClick={() => update("sizeMode", "custom")}>自定义</button>
                </div>
              </div>}
              {imageFormatOptions.length > 0 && <label className="creation-field">
                <small>输出格式</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.outputFormat}
                  onChange={updateImageOutputFormat}
                options={imageFormatOptions}
                  ariaLabel="输出格式"
                />
              </label>}
              <label className="creation-field">
                <small>背景限制</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.backgroundMode}
                  onChange={updateImageBackground}
                options={imageBackgroundOptions}
                  ariaLabel="背景限制"
                />
              </label>
            </div>
          )}
        </div>
      ) : flat ? (
        <>
          <div className="canvas-parameter-model">
            <label className="creation-field model">
              <small>图片模型</small>
              <ModelPicker
                models={models}
                value={settings.model}
                capability={modelCapabilities ?? (settings.mask ? ["edit"] : ["generate"])}
                portalZIndex={portalZIndex}
                dialogPortalZIndex={dialogPortalZIndex}
                defaultProviderId={runtime?.settings.defaultProviderId}
                defaultProviderName={defaultProvider?.name}
                defaultModelId={runtime?.settings.defaultImageModelId}
                onChange={updateImageModel}
              />
            </label>
          </div>
          <div className={`canvas-parameter-collection ${parameterDrawerOpen ? "open" : ""}`}>
            <button
              type="button"
              className="canvas-parameter-trigger"
              aria-expanded={parameterDrawerOpen}
              aria-controls="canvas-image-parameter-drawer"
              onClick={() => setParameterDrawerOpen((value) => !value)}
            >
              <span>
                <b>生成参数</b>
                <small>{parameterSummary}</small>
              </span>
              <i aria-hidden="true">{parameterDrawerOpen ? "⌃" : "⌄"}</i>
            </button>
            {parameterDrawerOpen && (
              <div className="canvas-parameter-drawer" id="canvas-image-parameter-drawer">
                <div className="canvas-parameter-drawer-head">
                  <span>
                    <b>参数集合</b>
                    <small>质量 · 清晰度 · 比例 · 数量</small>
                  </span>
                  <em>可随时调整</em>
                </div>
                {imageQualityOptions.length > 0 && <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">质量</span>
                  <div className="canvas-parameter-options quality" role="group" aria-label="图片质量">
                    {imageQualityOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={settings.quality === option.value ? "active" : ""}
                        aria-pressed={settings.quality === option.value}
                        title={option.description}
                        onClick={() => update("quality", option.value)}
                      >
                        {option.label.replace("质量", "")}
                      </button>
                    ))}
                  </div>
                </div>}
                {usesCangyuan ? (
                  <div className="canvas-parameter-group">
                    <span className="canvas-parameter-group-label">模型建议尺寸</span>
                    {cangyuanSizeSelect || <small>文档未列出建议尺寸，使用模型默认值</small>}
                  </div>
                ) : <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">尺寸方式</span>
                  <div className="canvas-parameter-options size-mode" role="group" aria-label="图片尺寸方式">
                    <button type="button" className={settings.sizeMode === "system" ? "active" : ""} aria-pressed={settings.sizeMode === "system"} onClick={() => update("sizeMode", "system")}>标准尺寸</button>
                    <button type="button" className={settings.sizeMode === "custom" ? "active" : ""} aria-pressed={settings.sizeMode === "custom"} onClick={() => update("sizeMode", "custom")}>自定义</button>
                  </div>
                </div>}
                {cangyuanResolutionSelect && <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">输出清晰度</span>
                  {cangyuanResolutionSelect}
                </div>}
                {!usesCangyuan && settings.sizeMode === "system" ? (
                  <div className="canvas-parameter-group">
                    <span className="canvas-parameter-group-label">清晰度</span>
                    <div className="canvas-parameter-options resolution" role="group" aria-label="图片分辨率">
                      {imageSizeOptions.map((item) => (
                        <button type="button" key={item.value} className={settings.resolution === item.value ? "active" : ""} aria-pressed={settings.resolution === item.value} title={`长边约 ${item.longEdge}px`} onClick={() => update("resolution", item.value)}>{item.label}</button>
                      ))}
                    </div>
                  </div>
                ) : !usesCangyuan ? (
                  <div className="canvas-parameter-group">
                    <span className="canvas-parameter-group-label">自定义尺寸</span>
                    <div className="creation-pixel-fields canvas-parameter-pixels">
                      <label><small>宽度</small><input type="number" min={1} max={16384} value={settings.width} onChange={(event) => update("width", Math.max(1, Number(event.target.value) || 1))} /></label>
                      <b>×</b>
                      <label><small>高度</small><input type="number" min={1} max={16384} value={settings.height} onChange={(event) => update("height", Math.max(1, Number(event.target.value) || 1))} /></label>
                    </div>
                  </div>
                ) : null}
                {(!usesCangyuan || cangyuanProfile?.supportsAspectRatio) && <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">比例</span>
                  <div className="canvas-parameter-options aspect" role="group" aria-label="图片比例">
                    {imageRatioOptions.map((value) => (
                      <button type="button" key={value} className={settings.aspect === value ? "active" : ""} aria-pressed={settings.aspect === value} data-ratio={value} title={ratioDescriptions[value]} onClick={() => update("aspect", value)}>
                        <i className="canvas-parameter-ratio-icon" aria-hidden="true" />
                        <span>{value === "自动" ? "自动" : value}</span>
                      </button>
                    ))}
                  </div>
                </div>}
                {!usesCangyuan && settings.aspect === "自定义" && (
                  <div className="creation-custom-ratio canvas-parameter-custom-ratio">
                    <span>自定义比例</span>
                    <input type="number" min={1} value={settings.customAspectWidth} onChange={(event) => update("customAspectWidth", Math.max(1, Number(event.target.value) || 1))} />
                    <b>:</b>
                    <input type="number" min={1} value={settings.customAspectHeight} onChange={(event) => update("customAspectHeight", Math.max(1, Number(event.target.value) || 1))} />
                  </div>
                )}
                <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">生成数量</span>
                  <div className="canvas-parameter-options count" role="group" aria-label="生成数量">
                    {imageCountOptions.map((value) => (
                    <button type="button" key={value} className={selectedImageCount === value ? "active" : ""} aria-pressed={selectedImageCount === value} onClick={() => update("count", value)}>{value} 张</button>
                    ))}
                  </div>
                </div>
                {cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">生成系列</span>
                  {cangyuanSeriesSelect}
                </div>}
                {cangyuanVariantField}
                <button
                  type="button"
                  className={`creation-advanced-toggle ${advanced ? "active" : ""}`}
                  onClick={() => setAdvanced((value) => !value)}
                  aria-expanded={advanced}
                  title={advanced ? "收起格式与背景参数" : "展开格式与背景参数"}
                >
                  <span>{advanced ? "收起更多参数" : "更多参数"}</span>
                  <small>格式与背景</small>
                  <b>{advanced ? "⌃" : "⌄"}</b>
                </button>
                {advanced && (
                  <div className="creation-parameter-grid advanced canvas-parameter-extra-grid">
                    {cangyuanTierSelect && <label className="creation-field">
                      <small>生成档位</small>
                      {cangyuanTierSelect}
                    </label>}
                    {!cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <label className="creation-field">
                      <small>生成系列</small>
                      {cangyuanSeriesSelect}
                    </label>}
                    {cangyuanPromptExpansionControl}
                    {cangyuanSeedField}
                    {cangyuanProfile && <CangyuanImageModelOptions
                      profile={cangyuanProfile}
                      settings={settings}
                      referenceCount={referenceCount}
                      portalZIndex={portalZIndex}
                      onChange={onChange}
                    />}
                    {imageFormatOptions.length > 0 && <label className="creation-field">
                      <small>输出格式</small>
                      <SelectMenu
                        portalZIndex={portalZIndex}
                        value={settings.outputFormat}
                        onChange={updateImageOutputFormat}
                        options={imageFormatOptions}
                        ariaLabel="输出格式"
                      />
                    </label>}
                    <label className="creation-field">
                      <small>背景限制</small>
                      <SelectMenu
                        portalZIndex={portalZIndex}
                        value={settings.backgroundMode}
                        onChange={updateImageBackground}
                        options={imageBackgroundOptions}
                        ariaLabel="背景限制"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
      <div className="creation-parameter-grid primary">
        <label className="creation-field model">
          <small>图片模型</small>
          <ModelPicker
            models={models}
            value={settings.model}
            capability={modelCapabilities ?? (settings.mask ? ["edit"] : ["generate"])}
            portalZIndex={portalZIndex}
            dialogPortalZIndex={dialogPortalZIndex}
            defaultProviderId={runtime?.settings.defaultProviderId}
            defaultProviderName={defaultProvider?.name}
            defaultModelId={runtime?.settings.defaultImageModelId}
            onChange={updateImageModel}
          />
        </label>
        {(!usesCangyuan || cangyuanProfile?.supportsAspectRatio) && <label className="creation-field">
          <small>比例</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.aspect}
            onChange={(value) => update("aspect", value)}
            options={imageRatioOptions.map((value) => ({
              value,
              label: value,
              description: ratioDescriptions[value],
            }))}
            ariaLabel="图片比例"
          />
        </label>}
        {usesCangyuan ? (
          <label className="creation-field">
            <small>模型建议尺寸</small>
            {cangyuanSizeSelect || <span>使用模型默认值</span>}
          </label>
        ) : <label className="creation-field">
          <small>尺寸方式</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.sizeMode}
            onChange={(value) => update("sizeMode", value)}
            options={[
              {
                value: "system",
                label: "标准尺寸",
                description: "按比例和分辨率自动计算",
              },
              {
                value: "custom",
                label: "自定义像素",
                description: "直接输入输出宽高",
              },
            ]}
            ariaLabel="图片尺寸方式"
          />
        </label>}
        {cangyuanResolutionSelect && <label className="creation-field">
          <small>输出清晰度</small>
          {cangyuanResolutionSelect}
        </label>}
        {!usesCangyuan && settings.sizeMode === "system" ? (
          <label className="creation-field">
            <small>分辨率</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.resolution}
              onChange={(value) => update("resolution", value)}
              options={imageSizeOptions.map((item) => ({
                value: item.value,
                label: item.label,
                description: `长边约 ${item.longEdge}px`,
              }))}
              ariaLabel="图片分辨率"
            />
          </label>
        ) : !usesCangyuan ? (
          <div className="creation-pixel-fields">
            <label>
              <small>宽度</small>
              <input
                type="number"
                min={1}
                max={16384}
                value={settings.width}
                onChange={(event) =>
                  update("width", Math.max(1, Number(event.target.value) || 1))
                }
              />
            </label>
            <b>×</b>
            <label>
              <small>高度</small>
              <input
                type="number"
                min={1}
                max={16384}
                value={settings.height}
                onChange={(event) =>
                  update("height", Math.max(1, Number(event.target.value) || 1))
                }
              />
            </label>
          </div>
        ) : null}
        <label className="creation-field compact">
          <small>数量</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={selectedImageCount}
            onChange={(value) => update("count", value)}
            options={imageCountOptions.map((value) => ({
              value,
              label: `${value} 张`,
            }))}
            ariaLabel="生成数量"
          />
        </label>
        {cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <label className="creation-field">
          <small>生成系列</small>
          {cangyuanSeriesSelect}
        </label>}
        {cangyuanVariantField}
        {flat && imageQualityOptions.length > 0 && (
          <label className="creation-field compact">
            <small>质量</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.quality}
              onChange={(value) => update("quality", value)}
              options={imageQualityOptions}
              ariaLabel="图片质量"
            />
          </label>
        )}
      </div>
      {!usesCangyuan && settings.aspect === "自定义" && (
        <div className="creation-custom-ratio">
          <span>自定义比例</span>
          <input
            type="number"
            min={1}
            value={settings.customAspectWidth}
            onChange={(event) =>
              update(
                "customAspectWidth",
                Math.max(1, Number(event.target.value) || 1),
              )
            }
          />
          <b>:</b>
          <input
            type="number"
            min={1}
            value={settings.customAspectHeight}
            onChange={(event) =>
              update(
                "customAspectHeight",
                Math.max(1, Number(event.target.value) || 1),
              )
            }
          />
        </div>
      )}
      <button
        type="button"
        className={`creation-advanced-toggle ${advanced ? "active" : ""}`}
        onClick={() => setAdvanced((value) => !value)}
        aria-expanded={advanced}
        title={advanced ? "收起更多图片参数" : "展开格式与背景参数"}
      >
        <span>{advanced ? "收起" : flat ? "更多参数" : "高级"}</span>
        <small>{flat ? "格式与背景" : "质量、格式与背景"}</small>
        <b>{advanced ? "⌃" : "⌄"}</b>
      </button>
      {advanced && (
        <div className="creation-parameter-grid advanced">
          {cangyuanTierSelect && <label className="creation-field">
            <small>生成档位</small>
            {cangyuanTierSelect}
          </label>}
          {!cangyuanProfile?.seriesRequired && cangyuanSeriesSelect && <label className="creation-field">
            <small>生成系列</small>
            {cangyuanSeriesSelect}
          </label>}
          {cangyuanPromptExpansionControl}
          {cangyuanSeedField}
          {cangyuanProfile && <CangyuanImageModelOptions
            profile={cangyuanProfile}
            settings={settings}
            referenceCount={referenceCount}
            portalZIndex={portalZIndex}
            onChange={onChange}
          />}
          {!flat && imageQualityOptions.length > 0 && (
            <label className="creation-field">
              <small>质量</small>
              <SelectMenu
                portalZIndex={portalZIndex}
                value={settings.quality}
                onChange={(value) => update("quality", value)}
                options={imageQualityOptions}
                ariaLabel="图片质量"
              />
            </label>
          )}
          {imageFormatOptions.length > 0 && <label className="creation-field">
            <small>输出格式</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.outputFormat}
              onChange={updateImageOutputFormat}
              options={imageFormatOptions}
              ariaLabel="输出格式"
            />
          </label>}
          <label className="creation-field">
            <small>背景限制</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.backgroundMode}
              onChange={updateImageBackground}
              options={imageBackgroundOptions}
              ariaLabel="背景限制"
            />
          </label>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function durationValues(
  minimum: number,
  maximum: number,
  fixed?: number,
  allowed?: number[],
  current?: number,
) {
  if (fixed) return [fixed];
  if (allowed?.length) return allowed;
  return [
    ...new Set(
      [minimum, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, maximum, current].filter(
        (value): value is number =>
          typeof value === "number" && value >= minimum && value <= maximum,
      ),
    ),
  ].sort((left, right) => left - right);
}

function cangyuanVideoParameterValues(
  spec: CangyuanVideoModelSpec | null,
  values: VideoModelParameterValues = {},
): VideoModelParameterValues {
  if (!spec) return {};
  const parameters = getCangyuanVideoAdvancedParameters(spec);
  const allowedNames = new Set(parameters.map((parameter) => parameter.name));
  if (getCangyuanVideoParameter(spec, "seed")) allowedNames.add("seed");
  const defaults = Object.fromEntries(parameters
    .filter((parameter) => parameter.suggestedDefault !== undefined)
    .map((parameter) => [parameter.name, parameter.suggestedDefault])) as VideoModelParameterValues;
  const stored = Object.fromEntries(Object.entries(values).filter(([name]) => allowedNames.has(name))) as VideoModelParameterValues;
  return { ...defaults, ...stored };
}

function VideoEditor({
  settings,
  runtime,
  unavailableModelId,
  videoModelInput,
  variant,
  onChange,
  onVideoInputModeChange,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
}: {
  settings: VideoCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  videoModelInput?: VideoModelInputContext;
  variant?: Props["variant"];
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  onChange: Props["onChange"];
  onVideoInputModeChange?: Props["onVideoInputModeChange"];
}) {
  const dock = variant === "dock";
  const canvasCompact = variant === "dock" || variant === "canvas-flat";
  const [agnesV20DurationOpen, setAgnesV20DurationOpen] = useState(false);
  const [agnesV20DimensionOpen, setAgnesV20DimensionOpen] = useState(false);
  const update = <K extends keyof VideoCreationSettings>(
    key: K,
    value: VideoCreationSettings[K],
  ) => onChange({ ...settings, [key]: value });
  const operationModel = runtime
    ? resolveAvailableCreationModel(settings, runtime).model
    : null;
  // The editor may receive `auto` or a historical model id. Always derive
  // capabilities and limits from the model that will actually be submitted,
  // otherwise automatic selection silently falls back to generic limits.
  const model = operationModel;
  const provider = runtime?.providers.find(
    (item) => item.id === operationModel?.providerId,
  );
  const usesCangyuan = usesCangyuanVideoProtocol(provider);
  const cangyuanProfile = usesCangyuan && model
    ? getCangyuanVideoModelProfile(model.rawId)
    : null;
  const cangyuanSpec = usesCangyuan && model && cangyuanProfile
    ? getCangyuanVideoModelSpec(model.rawId)
    : null;
  const cangyuanParameters = cangyuanVideoParameterValues(cangyuanSpec, settings.modelParameters);
  const cangyuanAspectEnum = cangyuanSpec
    ? getCangyuanVideoParameter(cangyuanSpec, "aspect_ratio")?.enum
    : undefined;
  const cangyuanAspectOptions = Array.isArray(cangyuanAspectEnum)
    ? cangyuanAspectEnum
    : cangyuanAspectEnum ? [cangyuanAspectEnum] : [];
  const cangyuanSuggestedResolutions = cangyuanProfile?.suggestedResolutions.filter(
    (value) => !cangyuanProfile.unsupportedResolutions?.includes(value.toLowerCase()),
  ) ?? [];
  const cangyuanResolutionOptions = cangyuanProfile?.allowedResolutions?.filter(
    (value) => !cangyuanProfile.unsupportedResolutions?.includes(value.toLowerCase()),
  );
  const cangyuanResolutionValue = cangyuanSuggestedResolutions.find(
    (value) => value.toLowerCase() === settings.resolution.toLowerCase(),
  ) ?? settings.resolution;
  const limits = useMemo(
    () => getVideoModelLimitsForInput(model || undefined, provider, videoModelInput || {}),
    [
      model,
      provider,
      videoModelInput?.hasFirstFrame,
      videoModelInput?.hasLastFrame,
      videoModelInput?.referenceImageCount,
      videoModelInput?.referenceVideoCount,
      videoModelInput?.audioCount,
    ],
  );
  const supports = (capability: ModelCapability) =>
    !model || model.capabilities.includes(capability);
  // Providers that expose only the coarse video-generate capability often do
  // support image-to-video, but omit granular input metadata. Keep the canvas
  // and main video panels consistent by treating it as image-input capable;
  // audio remains gated by its explicit capability below.
  const supportsImageInput =
    usesCangyuan
      ? Boolean(cangyuanProfile?.supportsFirstFrame)
      : (!model || model.capabilities.includes("video-generate") || model.capabilities.includes("video-first-frame"));
  const supportsReferenceImages =
    usesCangyuan
      ? Boolean(cangyuanProfile?.supportsReferenceImages || cangyuanProfile?.supportsReferenceVideos || cangyuanProfile?.supportsReferenceAudios)
      : (!model || model.capabilities.includes("video-generate") || model.capabilities.includes("video-reference"));
  const usesAgnesV20 = Boolean(model?.rawId && /agnes-video-v2\.0/i.test(model.rawId));
  const supportsAudio = usesCangyuan
    ? Boolean(cangyuanProfile?.supportsGenerateAudio)
    : !usesAgnesV20 && (supports("video-audio") || !is65535Provider(provider));
  const supportsOperationEdit =
    usesCangyuan ? Boolean(cangyuanProfile?.supportsEdit) : (!operationModel || operationModel.capabilities.includes("video-edit"));
  const supportsOperationExtend =
    usesCangyuan ? Boolean(cangyuanProfile?.supportsExtend) : (!operationModel || operationModel.capabilities.includes("video-extend"));
  const operationOptions = [
    {
      value: "generate" as const,
      label: "生成视频",
      description: "根据提示词和画面输入生成",
    },
    ...(supportsOperationEdit
      ? [
          {
            value: "edit" as const,
            label: "视频编辑",
            description: "根据已有视频修改",
          },
        ]
      : []),
    ...(supportsOperationExtend
      ? [
          {
            value: "extend" as const,
            label: "视频续写",
            description: "延续已有镜头",
          },
        ]
      : []),
  ];
  const inputOptions = [
    ...(!usesCangyuan || cangyuanProfile?.allowsNoReferences !== false && !cangyuanProfile?.requiresReferenceImage
      ? [{ value: "text" as const, label: "文生视频", description: "仅使用提示词" }]
      : []),
    ...(!usesCangyuan && supportsImageInput
      ? [
          {
            value: "first-frame" as const,
            label: "图生视频 · 首帧",
            description: "第 1 张参考图作为首帧",
          },
          {
            value: "frames" as const,
            label: "图生视频 · 首尾帧",
            description: "第 1、2 张图约束起止",
          },
        ]
      : []),
    ...(usesCangyuan && supportsImageInput && cangyuanProfile?.allowsFirstFrameWithoutLastFrame !== false
      ? [{ value: "first-frame" as const, label: "图生视频 · 首帧", description: "使用一张图片作为首帧，平台自动处理上传" }]
      : []),
    ...(usesCangyuan && cangyuanProfile?.supportsFirstLastFrames
      ? [{ value: "frames" as const, label: "图生视频 · 首尾帧", description: "两张图片分别约束起始和结束画面" }]
      : []),
    ...(supportsReferenceImages
      ? [
          {
            value: "reference" as const,
            label: usesCangyuan && !cangyuanProfile?.supportsReferenceImages ? "参考素材生视频" : "参考图生视频",
            description: usesCangyuan && !cangyuanProfile?.supportsReferenceImages ? "使用模型支持的视频或音频素材" : `最多 ${limits.maxReferenceImages} 张`,
          },
        ]
      : []),
  ];
  const showOperationField = operationOptions.length > 1;
  const durationsForResolution = (resolution: string) => durationValues(
      limits.minSeconds,
      limits.maxSeconds,
      limits.fixedSeconds,
      limits.allowedSeconds,
      settings.duration,
    ).filter((value) => !cangyuanProfile?.unsupportedSecondsByResolution?.[resolution.toLowerCase()]?.includes(value));
  const allowedDurations = durationsForResolution(settings.resolution);
  const updateCangyuanResolution = (resolution: string) => {
    const durations = durationsForResolution(resolution);
    const duration = durations.includes(settings.duration)
      ? settings.duration
      : durations.reduce((nearest, value) => Math.abs(value - settings.duration) < Math.abs(nearest - settings.duration) ? value : nearest,
        durations[0] ?? limits.minSeconds);
    onChange({ ...settings, resolution, duration });
  };
  const normalizedDuration = allowedDurations.includes(settings.duration)
    ? settings.duration
    : allowedDurations.reduce((nearest, value) =>
        Math.abs(value - settings.duration) < Math.abs(nearest - settings.duration) ? value : nearest,
      allowedDurations[0] || limits.minSeconds);
  const selectedResolution =
    limits.resolutions.find(
      (value) => value.toLowerCase() === settings.resolution.toLowerCase(),
    ) || limits.resolutions[0] || "720p";
  const normalizedResolution = limits.resolutions.some(
    (value) => value.toLowerCase() === settings.resolution.toLowerCase(),
  ) ? settings.resolution : selectedResolution;
  const normalizedAspect = limits.aspectRatioSource === "first-reference" ? "auto" : settings.aspect;
  const selectedAgnesV20Duration = AGNES_V20_DURATION_PRESETS.find(
    (preset) =>
      preset.frames === settings.agnesNumFrames &&
      preset.frameRate === settings.agnesFrameRate,
  );
  const selectedAgnesV20Dimensions = AGNES_V20_DIMENSION_PRESETS.find(
    (preset) =>
      preset.width === settings.agnesWidth &&
      preset.height === settings.agnesHeight,
  );
  const applyAgnesV20Duration = (
    preset: (typeof AGNES_V20_DURATION_PRESETS)[number],
  ) => onChange({
    ...settings,
    agnesNumFrames: preset.frames,
    agnesFrameRate: preset.frameRate,
  });
  const applyAgnesV20Dimensions = (
    preset: (typeof AGNES_V20_DIMENSION_PRESETS)[number],
  ) => onChange({
    ...settings,
    agnesWidth: preset.width,
    agnesHeight: preset.height,
  });
  const agnesV20AdvancedFields = (
    <div className="video-v20-advanced-fields">
      <label>宽度（px）<input aria-label="宽度" type="number" min={64} max={3840} step={64} value={settings.agnesWidth} onChange={(event) => update("agnesWidth", Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
      <label>高度（px）<input aria-label="高度" type="number" min={64} max={3840} step={64} value={settings.agnesHeight} onChange={(event) => update("agnesHeight", Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
      <label>帧数（8n+1）<input aria-label="帧数" type="number" min={1} max={441} step={8} value={settings.agnesNumFrames} onChange={(event) => { const value = Math.round(Number(event.target.value) || 1); update("agnesNumFrames", Math.max(1, Math.min(441, Math.round((value - 1) / 8) * 8 + 1))); }} /></label>
      <label>帧率（FPS）<input aria-label="帧率" type="number" min={1} max={60} step={1} value={settings.agnesFrameRate} onChange={(event) => update("agnesFrameRate", Math.max(1, Math.min(60, Math.round(Number(event.target.value) || 1))))} /></label>
    </div>
  );
  const agnesV20ParameterContent = (
    <>
      <div className="video-v20-heading"><span>V2.0 专属参数</span><small>旧版接口用帧数控制时长，不能直接填写秒数。</small></div>
      <div className="video-v20-preset-group">
        <span>快速选时长</span>
        <div className="video-v20-preset-list" role="group" aria-label="Agnes V2.0 时长预设">
          {AGNES_V20_DURATION_PRESETS.map((preset) => <button key={preset.frames} type="button" className={selectedAgnesV20Duration?.frames === preset.frames ? "selected" : ""} onClick={() => applyAgnesV20Duration(preset)}><b>{preset.label}</b><small>{preset.frames} 帧 / {preset.frameRate} FPS</small></button>)}
        </div>
      </div>
      <div className="video-v20-preset-group">
        <span>快速选画幅</span>
        <div className="video-v20-preset-list" role="group" aria-label="Agnes V2.0 画幅预设">
          {AGNES_V20_DIMENSION_PRESETS.map((preset) => <button key={preset.label} type="button" className={selectedAgnesV20Dimensions?.width === preset.width && selectedAgnesV20Dimensions?.height === preset.height ? "selected" : ""} onClick={() => applyAgnesV20Dimensions(preset)}><b>{preset.label}</b><small>{preset.width} × {preset.height}</small></button>)}
        </div>
      </div>
      <div className="video-v20-advanced-label"><span>高级自定义</span><small>宽高须为 64 的倍数；帧数须满足 8n + 1。</small></div>
      {agnesV20AdvancedFields}
      <small className="video-model-parameter-help">预计时长约 {(Math.max(1, settings.agnesNumFrames) / Math.max(1, settings.agnesFrameRate)).toFixed(1)} 秒（按官方 num_frames ÷ frame_rate 估算）</small>
    </>
  );
  useEffect(() => {
    if ((!agnesV20DurationOpen && !agnesV20DimensionOpen) || !canvasCompact) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setAgnesV20DurationOpen(false);
      setAgnesV20DimensionOpen(false);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [agnesV20DurationOpen, agnesV20DimensionOpen, canvasCompact]);
  useEffect(() => {
    const operationIsSupported =
      settings.operation === "generate" ||
      (settings.operation === "edit" && supportsOperationEdit) ||
      (settings.operation === "extend" && supportsOperationExtend);
    const nextOperation = operationIsSupported ? settings.operation : "generate";
    if (nextOperation !== settings.operation)
      onChange({ ...settings, operation: nextOperation });
  }, [onChange, settings, supportsOperationEdit, supportsOperationExtend]);
  useEffect(() => {
    if (!limits.durationScope && !limits.aspectRatioSource) return;
    if (
      settings.duration === normalizedDuration &&
      settings.resolution === normalizedResolution &&
      settings.aspect === normalizedAspect
    ) return;
    onChange({
      ...settings,
      duration: normalizedDuration,
      resolution: normalizedResolution,
      aspect: normalizedAspect,
    });
  }, [limits.durationScope, normalizedAspect, normalizedDuration, normalizedResolution, onChange, settings]);
  const inheritSettings =
    settings.operation !== "generate" &&
    Boolean(limits.inheritVideoSettingsFor?.includes(settings.operation));
  const omitRatio =
    inheritSettings ||
    limits.aspectRatioSource === "first-reference" ||
    (settings.operation !== "generate" &&
      Boolean(
        limits.omitAspectRatioResolutionFor?.includes(settings.operation),
      ));
  const omitResolution =
    inheritSettings ||
    (settings.operation !== "generate" &&
      Boolean(limits.omitAspectRatioResolutionFor?.includes(settings.operation)));
  return (
    <div className={`creation-parameter-editor video${canvasCompact ? " canvas-compact" : ""}`}>
      {unavailableModelId && (
        <div className="creation-model-warning">
          <b>原模型当前不可用</b>
          <span>{unavailableModelId} 将在重新生成时回退到自动模型。</span>
        </div>
      )}
      <div className="creation-parameter-grid primary video-primary-grid">
        {!dock && (
          <label className="creation-field model">
            <small>视频模型</small>
            <ModelPicker
              models={runtime?.models || []}
              value={settings.model}
              capability="video-generate"
              portalZIndex={portalZIndex}
              dialogPortalZIndex={dialogPortalZIndex}
              defaultProviderId={runtime?.settings.defaultProviderId}
              defaultProviderName={
                runtime?.providers.find(
                  (item) => item.id === runtime.settings.defaultProviderId,
                )?.name
              }
              defaultModelId={runtime?.settings.defaultVideoModelId}
              onChange={(value) => {
                const nextSettings = { ...settings, model: value };
                const nextModel = runtime
                  ? resolveAvailableCreationModel(nextSettings, runtime).model
                  : null;
                const nextProvider = runtime?.providers.find((item) => item.id === nextModel?.providerId);
                const nextSpec = usesCangyuanVideoProtocol(nextProvider) && nextModel
                  ? getCangyuanVideoModelSpec(nextModel.rawId)
                  : null;
                const nextProfile = nextSpec && nextModel ? getCangyuanVideoModelProfile(nextModel.rawId) : null;
                const nextInputModes: VideoInputMode[] = nextProfile ? [
                  ...(nextProfile.allowsNoReferences !== false && !nextProfile.requiresReferenceImage ? ["text" as const] : []),
                  ...(nextProfile.supportsFirstFrame && nextProfile.allowsFirstFrameWithoutLastFrame !== false ? ["first-frame" as const] : []),
                  ...(nextProfile.supportsFirstLastFrames ? ["frames" as const] : []),
                  ...(nextProfile.supportsReferenceImages || nextProfile.supportsReferenceVideos || nextProfile.supportsReferenceAudios ? ["reference" as const] : []),
                ] : [];
                const nextInputMode = nextInputModes.includes(settings.inputMode)
                  ? settings.inputMode
                  : settings.inputMode !== "text" && nextInputModes.includes("reference")
                    ? "reference"
                    : nextInputModes[0] ?? "text";
                onChange({
                  ...nextSettings,
                  modelParameters: cangyuanVideoParameterValues(nextSpec),
                  ...(nextProfile ? {
                    duration: nextProfile.durationDefault ?? Math.max(nextProfile.minSeconds, Math.min(nextProfile.maxSeconds, settings.duration)),
                    aspect: nextProfile.aspectRatioDefault ?? nextProfile.suggestedAspectRatios[0] ?? settings.aspect,
                    resolution: nextProfile.resolutionDefault ?? nextProfile.suggestedResolutions[0] ?? settings.resolution,
                    audio: nextProfile.supportsGenerateAudio ? nextProfile.generateAudioDefault ?? true : false,
                    inputMode: nextInputMode,
                  } : {}),
                });
              }}
            />
          </label>
        )}
        {showOperationField && (
          <label className="creation-field">
            <small>操作</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.operation}
              onChange={(value) => update("operation", value)}
              options={operationOptions}
              ariaLabel="视频操作"
            />
          </label>
        )}
        {inputOptions.length > 1 && <label className="creation-field">
          <small>生成方式</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.inputMode}
            onChange={(value) => {
              onVideoInputModeChange?.(value);
              update("inputMode", value);
            }}
            options={inputOptions}
            ariaLabel="视频生成方式"
          />
        </label>}
        {!usesAgnesV20 && !usesCangyuan && <label className={`creation-field${allowedDurations.some((value) => value > 60) ? " video-duration-wide" : ""}`}>
          <small>{limits.durationScope === "per-transition" ? "每段转场时长" : limits.durationScope === "total" ? "总时长" : "时长"}</small>
            <VideoDurationField
            portalZIndex={portalZIndex}
            disabled={inheritSettings}
            value={settings.duration}
            onChange={(value) => update("duration", value)}
              values={allowedDurations}
            ariaLabel="视频时长"
          />
        </label>}
        {!usesAgnesV20 && !usesCangyuan && <label className="creation-field">
          <small>比例</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            disabled={omitRatio}
            value={normalizedAspect}
            onChange={(value) => update("aspect", value)}
            options={VIDEO_RATIOS.map((value) => ({
              value,
              label: value === "auto" ? "自动" : value,
              description: ratioDescriptions[value],
            }))}
            ariaLabel="视频比例"
          />
        </label>}
        {!usesAgnesV20 && !usesCangyuan && <label className="creation-field">
          <small>分辨率</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            disabled={omitResolution}
            value={selectedResolution}
            onChange={(value) => update("resolution", value)}
            options={limits.resolutions.map((value) => ({
              value,
              label: value.toUpperCase(),
              description:
                value === "720p"
                  ? "推荐"
                  : value === "480p"
                    ? "更快"
                    : "更清晰",
            }))}
            ariaLabel="视频分辨率"
          />
        </label>}
        {usesCangyuan && cangyuanProfile && <>
          {cangyuanProfile.supportsDuration && <label className={`creation-field${allowedDurations.some((value) => value > 60) ? " video-duration-wide" : ""}`}>
            <small>时长</small>
            <VideoDurationField
              portalZIndex={portalZIndex}
              value={settings.duration}
              onChange={(value) => update("duration", value)}
              values={allowedDurations}
              ariaLabel="视频时长"
            />
          </label>}
          {cangyuanProfile.supportsAspectRatio && <label className="creation-field">
            <small>比例</small>
            {cangyuanAspectOptions?.length ? <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.aspect}
              options={cangyuanAspectOptions.map((value) => ({ value: String(value), label: cangyuanVideoParameterValueLabel("aspect_ratio", String(value)) }))}
              ariaLabel="视频比例"
              onChange={(value) => update("aspect", value)}
            /> : <EditableSuggestionField
              value={settings.aspect}
              options={cangyuanProfile.suggestedAspectRatios}
              optionLabel={(value) => cangyuanVideoParameterValueLabel("aspect_ratio", value)}
              ariaLabel="视频比例"
              placeholder="例如 16:9"
              onChange={(value) => update("aspect", value)}
            />}
          </label>}
          {cangyuanProfile.supportsResolution && <label className="creation-field">
            <small>分辨率</small>
            {cangyuanResolutionOptions?.length ? <SelectMenu
              portalZIndex={portalZIndex}
              value={cangyuanResolutionValue}
              options={cangyuanResolutionOptions.map((value) => ({ value, label: cangyuanVideoParameterValueLabel("resolution", value) }))}
              ariaLabel="视频分辨率"
              onChange={updateCangyuanResolution}
            /> : <EditableSuggestionField
              value={cangyuanResolutionValue}
              options={cangyuanSuggestedResolutions}
              optionLabel={(value) => cangyuanVideoParameterValueLabel("resolution", value)}
              ariaLabel="视频分辨率"
              placeholder="例如 720p"
              onChange={updateCangyuanResolution}
            />}
          </label>}
          {cangyuanProfile.supportsSeed && <label className="creation-field">
            <small>随机种子</small>
            <input className="creation-field-input" type="number" aria-label="视频随机种子" min={cangyuanProfile.seedMin} max={cangyuanProfile.seedMax} step={1}
              value={String(cangyuanParameters.seed ?? "")} placeholder="留空随机"
              onChange={(event) => update("modelParameters", { ...cangyuanParameters, seed: event.target.value })} />
          </label>}
        </>}
        {(!usesCangyuan || supportsAudio) && <label className="creation-field creation-toggle">
          <small>原生音频</small>
          <button
            type="button"
            disabled={!supportsAudio}
            className={settings.audio ? "active" : ""}
            aria-pressed={settings.audio}
            onClick={() => update("audio", !settings.audio)}
          >
            <span>{settings.audio ? "已开启" : "关闭"}</span>
            <i />
          </button>
        </label>}
      </div>
      {usesAgnesV20 && (
        canvasCompact ? (
          <div className={`video-option-segment video-v20-parameter-panel video-v20-parameter-panel-canvas${agnesV20DurationOpen || agnesV20DimensionOpen ? " open" : ""}`}>
            <div className="video-v20-canvas-quick-row">
              <span className="video-v20-canvas-title">V2.0 专属参数</span>
              <div className={`video-v20-canvas-fold${agnesV20DurationOpen ? " open" : ""}`}>
                <button type="button" className="video-v20-canvas-fold-trigger" aria-expanded={agnesV20DurationOpen} aria-controls="canvas-video-v20-duration-drawer" onClick={() => { setAgnesV20DurationOpen((value) => !value); setAgnesV20DimensionOpen(false); }}>
                  <span><b>时长</b><small>{selectedAgnesV20Duration?.label || `${settings.agnesNumFrames} 帧 / ${settings.agnesFrameRate} FPS`}</small></span>
                  <i aria-hidden="true">{agnesV20DurationOpen ? "⌃" : "⌄"}</i>
                </button>
                {agnesV20DurationOpen && (
                  <div className="video-v20-canvas-fold-drawer" id="canvas-video-v20-duration-drawer" role="region" aria-label="Agnes V2.0 时长预设">
                    <div className="video-v20-preset-list">
                      {AGNES_V20_DURATION_PRESETS.map((preset) => {
                        const selected = selectedAgnesV20Duration?.frames === preset.frames;
                        return <button key={preset.frames} type="button" className={`video-v20-drawer-option${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => applyAgnesV20Duration(preset)}><span><b>{preset.label}</b><small>{preset.frames} 帧 / {preset.frameRate} FPS</small></span>{selected && <i aria-hidden="true">✓</i>}</button>;
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className={`video-v20-canvas-fold dimension${agnesV20DimensionOpen ? " open" : ""}`}>
                <button type="button" className="video-v20-canvas-fold-trigger" aria-expanded={agnesV20DimensionOpen} aria-controls="canvas-video-v20-dimension-drawer" onClick={() => { setAgnesV20DimensionOpen((value) => !value); setAgnesV20DurationOpen(false); }}>
                  <span><b>画幅</b><small>{selectedAgnesV20Dimensions?.label || `${settings.agnesWidth} × ${settings.agnesHeight}`}</small></span>
                  <i aria-hidden="true">{agnesV20DimensionOpen ? "⌃" : "⌄"}</i>
                </button>
                {agnesV20DimensionOpen && (
                  <div className="video-v20-canvas-fold-drawer" id="canvas-video-v20-dimension-drawer" role="region" aria-label="Agnes V2.0 画幅预设">
                    <div className="video-v20-preset-list">
                      {AGNES_V20_DIMENSION_PRESETS.map((preset) => {
                        const selected = selectedAgnesV20Dimensions?.width === preset.width && selectedAgnesV20Dimensions?.height === preset.height;
                        return <button key={preset.label} type="button" className={`video-v20-drawer-option${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => applyAgnesV20Dimensions(preset)}><span><b>{preset.label}</b><small>{preset.width} × {preset.height}</small></span>{selected && <i aria-hidden="true">✓</i>}</button>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="video-v20-canvas-advanced-row">
              <div className="video-v20-advanced-label"><span>高级自定义</span><small>宽高 64 倍数 · 帧数 8n + 1</small></div>
              {agnesV20AdvancedFields}
            </div>
          </div>
        ) : (
          <div className="video-option-segment video-v20-parameter-panel">
            {agnesV20ParameterContent}
          </div>
        )
      )}
      {cangyuanSpec && <CangyuanVideoModelParameters
        spec={cangyuanSpec}
        values={cangyuanParameters}
        onChange={(modelParameters) => onChange({ ...settings, modelParameters })}
      />}
      {(limits.notes.length > 0 || inheritSettings || omitRatio || usesCangyuan) && (
        <div className="creation-model-notes">
          <b>
            {inheritSettings
              ? "参数沿用输入视频"
              : omitRatio
                ? "比例与分辨率沿用输入"
                : "当前模型限制"}
          </b>
          <span>
            {usesCangyuan
              ? cangyuanProfile
                ? `仅对已核实型号开放扩展参数。${limits.notes.join("；")}。上传大小与未公开数量上限属于本站中转服务限制。`
                : "当前型号的参数与素材要求尚未核实，请先选择已支持的型号。"
              : limits.notes.join(" · ") || "当前操作不会提交自定义比例和分辨率。"}
          </span>
        </div>
      )}
    </div>
  );
}

function AgentEditor({
  settings,
  runtime,
  unavailableModelId,
  onChange,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
}: {
  settings: AgentCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  onChange: Props["onChange"];
}) {
  const provider = runtime?.providers.find(
    (item) => item.id === runtime.settings.defaultProviderId,
  );
  return (
    <div className="creation-parameter-editor agent">
      {unavailableModelId && (
        <div className="creation-model-warning">
          <b>原对话模型当前不可用</b>
          <span>
            {unavailableModelId} 将在执行时回退到自动模型，节点快照不会被改写。
          </span>
        </div>
      )}
      <div className="creation-parameter-grid agent-primary">
        <label className="creation-field model">
          <small>Agent 对话模型</small>
          <ModelPicker
            models={runtime?.models || []}
            value={settings.model}
            capability="chat"
            portalZIndex={portalZIndex}
            dialogPortalZIndex={dialogPortalZIndex}
            defaultProviderId={runtime?.settings.defaultProviderId}
            defaultProviderName={provider?.name}
            defaultModelId={runtime?.settings.agentModelId}
            placeholder="选择对话模型"
            onChange={(model) => onChange({ ...settings, model })}
          />
        </label>
        <label className="creation-field">
          <small>联网方式</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.webMode}
            onChange={(webMode) => onChange({ ...settings, webMode })}
            options={[
              {
                value: "off",
                label: "关闭联网",
                description: "仅使用模型已有知识",
              },
              {
                value: "auto",
                label: "智能联网",
                description: "必要时自动搜索",
              },
              {
                value: "always",
                label: "始终联网",
                description: "每次都检索最新信息",
              },
            ]}
            ariaLabel="Agent 联网方式"
          />
        </label>
        <div className="creation-agent-note">
          <span>Agent</span>
          <small>回复会新建右侧文本节点，并保留本轮模型与上下文快照。</small>
        </div>
      </div>
    </div>
  );
}

export default function CreationParameterEditor({
  settings,
  runtime,
  unavailableModelId,
  referenceCount,
  modelCapabilities,
  videoModelInput,
  variant,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
  onChange,
  onVideoInputModeChange,
}: Props) {
  return settings.kind === "video" ? (
    <VideoEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      videoModelInput={videoModelInput}
      variant={variant}
      portalZIndex={portalZIndex}
      dialogPortalZIndex={dialogPortalZIndex}
      onChange={onChange}
      onVideoInputModeChange={onVideoInputModeChange}
    />
  ) : settings.kind === "text" ? (
    <AgentEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      portalZIndex={portalZIndex}
      dialogPortalZIndex={dialogPortalZIndex}
      onChange={onChange}
    />
  ) : (
    <ImageEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      referenceCount={referenceCount}
      modelCapabilities={modelCapabilities}
      variant={variant}
      portalZIndex={portalZIndex}
      dialogPortalZIndex={dialogPortalZIndex}
      onChange={onChange}
    />
  );
}

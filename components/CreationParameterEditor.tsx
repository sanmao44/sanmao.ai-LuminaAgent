"use client";

import { useEffect, useMemo, useState } from "react";
import ModelPicker from "./ModelPicker";
import SelectMenu from "./SelectMenu";
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
import { resolveAvailableCreationModel } from "@/lib/creation/settings";
import { getVideoModelLimits } from "@/lib/video-model-limits";
import { is65535Provider } from "@/lib/video-platform";
import type { ModelCapability, PublicState } from "@/lib/types";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";

type Props = {
  settings: CreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  referenceCount?: number;
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
  variant,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
  onChange,
}: {
  settings: ImageCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
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
  const provider = runtime?.providers.find(
    (item) => item.id === runtime.settings.defaultProviderId,
  );
  const qualityLabel = IMAGE_QUALITY_OPTIONS.find(
    (option) => option.value === settings.quality,
  )?.label.replace("质量", "") || settings.quality;
  const sizeLabel = settings.sizeMode === "system"
    ? settings.resolution
    : `${settings.width}×${settings.height}`;
  const parameterSummary = `${settings.aspect} · ${qualityLabel} · ${sizeLabel} · ${settings.count} 张`;
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
      {dock ? (
        <div className="canvas-parameter-groups">
          <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">画质</span>
            <div className="canvas-parameter-options quality" role="group" aria-label="图片质量">
              {IMAGE_QUALITY_OPTIONS.map((option) => (
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
          </div>
          {settings.sizeMode === "system" ? (
            <div className="canvas-parameter-group">
              <span className="canvas-parameter-group-label">清晰度</span>
              <div className="canvas-parameter-options resolution" role="group" aria-label="图片分辨率">
                {IMAGE_SIZE_TIERS.map((item) => (
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
          <div className="canvas-parameter-group">
            <span className="canvas-parameter-group-label">比例</span>
            <div className="canvas-parameter-options aspect" role="group" aria-label="图片比例">
              {IMAGE_RATIOS.map((value) => (
                <button type="button" key={value} className={settings.aspect === value ? "active" : ""} aria-pressed={settings.aspect === value} data-ratio={value} title={ratioDescriptions[value]} onClick={() => update("aspect", value)}>
                  <i className="canvas-parameter-ratio-icon" aria-hidden="true" />
                  <span>{value === "自动" ? "自动" : value}</span>
                </button>
              ))}
            </div>
          </div>
          {settings.aspect === "自定义" && (
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
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <button type="button" key={value} className={settings.count === value ? "active" : ""} aria-pressed={settings.count === value} onClick={() => update("count", value)}>{value} 张</button>
              ))}
            </div>
          </div>
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
              <div className="canvas-parameter-group">
                <span className="canvas-parameter-group-label">尺寸方式</span>
                <div className="canvas-parameter-options size-mode" role="group" aria-label="图片尺寸方式">
                  <button type="button" className={settings.sizeMode === "system" ? "active" : ""} aria-pressed={settings.sizeMode === "system"} onClick={() => update("sizeMode", "system")}>标准尺寸</button>
                  <button type="button" className={settings.sizeMode === "custom" ? "active" : ""} aria-pressed={settings.sizeMode === "custom"} onClick={() => update("sizeMode", "custom")}>自定义</button>
                </div>
              </div>
              <label className="creation-field">
                <small>输出格式</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.outputFormat}
                  onChange={(value) => update("outputFormat", value)}
                  options={[
                    { value: "png", label: "PNG · 无损" },
                    { value: "jpeg", label: "JPEG · 体积更小" },
                    { value: "webp", label: "WebP · 适合网页" },
                  ]}
                  ariaLabel="输出格式"
                />
              </label>
              <label className="creation-field">
                <small>背景限制</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.backgroundMode}
                  onChange={(value) => onChange({ ...settings, backgroundMode: value, ...(value === "api-transparent" || value === "local-transparent" ? { outputFormat: "png" as const } : {}) })}
                  options={[
                    { value: "auto", label: "自动" },
                    { value: "api-transparent", label: "API 透明", description: "仅支持部分模型" },
                    { value: "local-transparent", label: "本地透明", description: "自动去白底并输出 PNG" },
                    { value: "opaque", label: "不透明" },
                  ]}
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
                capability={settings.mask ? "edit" : "generate"}
                portalZIndex={portalZIndex}
                dialogPortalZIndex={dialogPortalZIndex}
                defaultProviderId={runtime?.settings.defaultProviderId}
                defaultProviderName={provider?.name}
                defaultModelId={runtime?.settings.defaultImageModelId}
                onChange={(value) => update("model", value)}
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
                <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">质量</span>
                  <div className="canvas-parameter-options quality" role="group" aria-label="图片质量">
                    {IMAGE_QUALITY_OPTIONS.map((option) => (
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
                </div>
                <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">尺寸方式</span>
                  <div className="canvas-parameter-options size-mode" role="group" aria-label="图片尺寸方式">
                    <button type="button" className={settings.sizeMode === "system" ? "active" : ""} aria-pressed={settings.sizeMode === "system"} onClick={() => update("sizeMode", "system")}>标准尺寸</button>
                    <button type="button" className={settings.sizeMode === "custom" ? "active" : ""} aria-pressed={settings.sizeMode === "custom"} onClick={() => update("sizeMode", "custom")}>自定义</button>
                  </div>
                </div>
                {settings.sizeMode === "system" ? (
                  <div className="canvas-parameter-group">
                    <span className="canvas-parameter-group-label">清晰度</span>
                    <div className="canvas-parameter-options resolution" role="group" aria-label="图片分辨率">
                      {IMAGE_SIZE_TIERS.map((item) => (
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
                <div className="canvas-parameter-group">
                  <span className="canvas-parameter-group-label">比例</span>
                  <div className="canvas-parameter-options aspect" role="group" aria-label="图片比例">
                    {IMAGE_RATIOS.map((value) => (
                      <button type="button" key={value} className={settings.aspect === value ? "active" : ""} aria-pressed={settings.aspect === value} data-ratio={value} title={ratioDescriptions[value]} onClick={() => update("aspect", value)}>
                        <i className="canvas-parameter-ratio-icon" aria-hidden="true" />
                        <span>{value === "自动" ? "自动" : value}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {settings.aspect === "自定义" && (
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
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                      <button type="button" key={value} className={settings.count === value ? "active" : ""} aria-pressed={settings.count === value} onClick={() => update("count", value)}>{value} 张</button>
                    ))}
                  </div>
                </div>
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
                    <label className="creation-field">
                      <small>输出格式</small>
                      <SelectMenu
                        portalZIndex={portalZIndex}
                        value={settings.outputFormat}
                        onChange={(value) => update("outputFormat", value)}
                        options={[
                          { value: "png", label: "PNG · 无损" },
                          { value: "jpeg", label: "JPEG · 体积更小" },
                          { value: "webp", label: "WebP · 适合网页" },
                        ]}
                        ariaLabel="输出格式"
                      />
                    </label>
                    <label className="creation-field">
                      <small>背景限制</small>
                      <SelectMenu
                        portalZIndex={portalZIndex}
                        value={settings.backgroundMode}
                        onChange={(value) => onChange({ ...settings, backgroundMode: value, ...(value === "api-transparent" || value === "local-transparent" ? { outputFormat: "png" as const } : {}) })}
                        options={[
                          { value: "auto", label: "自动" },
                          { value: "api-transparent", label: "API 透明", description: "仅支持部分模型" },
                          { value: "local-transparent", label: "本地透明", description: "自动去白底并输出 PNG" },
                          { value: "opaque", label: "不透明" },
                        ]}
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
            capability={settings.mask ? "edit" : "generate"}
            portalZIndex={portalZIndex}
            dialogPortalZIndex={dialogPortalZIndex}
            defaultProviderId={runtime?.settings.defaultProviderId}
            defaultProviderName={provider?.name}
            defaultModelId={runtime?.settings.defaultImageModelId}
            onChange={(value) => update("model", value)}
          />
        </label>
        <label className="creation-field">
          <small>比例</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.aspect}
            onChange={(value) => update("aspect", value)}
            options={IMAGE_RATIOS.map((value) => ({
              value,
              label: value,
              description: ratioDescriptions[value],
            }))}
            ariaLabel="图片比例"
          />
        </label>
        <label className="creation-field">
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
        </label>
        {settings.sizeMode === "system" ? (
          <label className="creation-field">
            <small>分辨率</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.resolution}
              onChange={(value) => update("resolution", value)}
              options={IMAGE_SIZE_TIERS.map((item) => ({
                value: item.value,
                label: item.label,
                description: `长边约 ${item.longEdge}px`,
              }))}
              ariaLabel="图片分辨率"
            />
          </label>
        ) : (
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
        )}
        <label className="creation-field compact">
          <small>数量</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={settings.count}
            onChange={(value) => update("count", value)}
            options={[1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({
              value,
              label: `${value} 张`,
            }))}
            ariaLabel="生成数量"
          />
        </label>
        {flat && (
          <label className="creation-field compact">
            <small>质量</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.quality}
              onChange={(value) => update("quality", value)}
              options={IMAGE_QUALITY_OPTIONS}
              ariaLabel="图片质量"
            />
          </label>
        )}
      </div>
      {settings.aspect === "自定义" && (
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
          {!flat && (
            <label className="creation-field">
              <small>质量</small>
              <SelectMenu
                portalZIndex={portalZIndex}
                value={settings.quality}
                onChange={(value) => update("quality", value)}
                options={IMAGE_QUALITY_OPTIONS}
                ariaLabel="图片质量"
              />
            </label>
          )}
          <label className="creation-field">
            <small>输出格式</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.outputFormat}
              onChange={(value) => update("outputFormat", value)}
              options={[
                { value: "png", label: "PNG · 无损" },
                { value: "jpeg", label: "JPEG · 体积更小" },
                { value: "webp", label: "WebP · 适合网页" },
              ]}
              ariaLabel="输出格式"
            />
          </label>
          <label className="creation-field">
            <small>背景限制</small>
            <SelectMenu
              portalZIndex={portalZIndex}
              value={settings.backgroundMode}
              onChange={(value) =>
                onChange({
                  ...settings,
                  backgroundMode: value,
                  ...(value === "api-transparent" ||
                  value === "local-transparent"
                    ? { outputFormat: "png" as const }
                    : {}),
                })
              }
              options={[
                { value: "auto", label: "自动" },
                {
                  value: "api-transparent",
                  label: "API 透明",
                  description: "仅支持部分模型",
                },
                {
                  value: "local-transparent",
                  label: "本地透明",
                  description: "自动去白底并输出 PNG",
                },
                { value: "opaque", label: "不透明" },
              ]}
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

function VideoEditor({
  settings,
  runtime,
  unavailableModelId,
  variant,
  onChange,
  onVideoInputModeChange,
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
}: {
  settings: VideoCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  variant?: Props["variant"];
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  onChange: Props["onChange"];
  onVideoInputModeChange?: Props["onVideoInputModeChange"];
}) {
  const dock = variant === "dock";
  const canvasCompact = variant === "dock" || variant === "canvas-flat";
  const [agnesV20PanelOpen, setAgnesV20PanelOpen] = useState(!canvasCompact);
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
  const limits = useMemo(
    () => getVideoModelLimits(model || undefined, provider),
    [model, provider],
  );
  const supports = (capability: ModelCapability) =>
    !model || model.capabilities.includes(capability);
  // Providers that expose only the coarse video-generate capability often do
  // support image-to-video, but omit granular input metadata. Keep the canvas
  // and main video panels consistent by treating it as image-input capable;
  // audio remains gated by its explicit capability below.
  const supportsImageInput =
    !model ||
    model.capabilities.includes("video-generate") ||
    model.capabilities.includes("video-first-frame");
  const supportsReferenceImages =
    !model ||
    model.capabilities.includes("video-generate") ||
    model.capabilities.includes("video-reference");
  const usesAgnesV20 = Boolean(model?.rawId && /agnes-video-v2\.0/i.test(model.rawId));
  const supportsAudio = !usesAgnesV20 && (supports("video-audio") || !is65535Provider(provider));
  const supportsOperationEdit =
    !operationModel || operationModel.capabilities.includes("video-edit");
  const supportsOperationExtend =
    !operationModel || operationModel.capabilities.includes("video-extend");
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
    { value: "text" as const, label: "文生视频", description: "仅使用提示词" },
    ...(supportsImageInput
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
    ...(supportsReferenceImages
      ? [
          {
            value: "reference" as const,
            label: "参考图生视频",
            description: `最多 ${limits.maxReferenceImages} 张`,
          },
        ]
      : []),
  ];
  const showOperationField = operationOptions.length > 1;
  const allowedDurations = useMemo(
    () => durationValues(
      limits.minSeconds,
      limits.maxSeconds,
      limits.fixedSeconds,
      limits.allowedSeconds,
      settings.duration,
    ),
    [limits],
  );
  const selectedResolution =
    limits.resolutions.find(
      (value) => value.toLowerCase() === settings.resolution.toLowerCase(),
    ) || limits.resolutions[0] || "720p";
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
  const agnesV20ParameterSummary = `${settings.agnesWidth} × ${settings.agnesHeight} · ${settings.agnesNumFrames} 帧 / ${settings.agnesFrameRate} FPS`;
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
      <div className="video-v20-advanced-fields">
        <label>宽度（px）<input aria-label="宽度" type="number" min={64} max={3840} step={64} value={settings.agnesWidth} onChange={(event) => update("agnesWidth", Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
        <label>高度（px）<input aria-label="高度" type="number" min={64} max={3840} step={64} value={settings.agnesHeight} onChange={(event) => update("agnesHeight", Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
        <label>帧数（8n+1）<input aria-label="帧数" type="number" min={1} max={441} step={8} value={settings.agnesNumFrames} onChange={(event) => { const value = Math.round(Number(event.target.value) || 1); update("agnesNumFrames", Math.max(1, Math.min(441, Math.round((value - 1) / 8) * 8 + 1))); }} /></label>
        <label>帧率（FPS）<input aria-label="帧率" type="number" min={1} max={60} step={1} value={settings.agnesFrameRate} onChange={(event) => update("agnesFrameRate", Math.max(1, Math.min(60, Math.round(Number(event.target.value) || 1))))} /></label>
      </div>
      <small className="video-model-parameter-help">预计时长约 {(Math.max(1, settings.agnesNumFrames) / Math.max(1, settings.agnesFrameRate)).toFixed(1)} 秒（按官方 num_frames ÷ frame_rate 估算）</small>
    </>
  );
  useEffect(() => {
    if (!agnesV20PanelOpen || !canvasCompact) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setAgnesV20PanelOpen(false);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [agnesV20PanelOpen, canvasCompact]);
  useEffect(() => {
    const operationIsSupported =
      settings.operation === "generate" ||
      (settings.operation === "edit" && supportsOperationEdit) ||
      (settings.operation === "extend" && supportsOperationExtend);
    const nextOperation = operationIsSupported ? settings.operation : "generate";
    if (nextOperation !== settings.operation)
      onChange({ ...settings, operation: nextOperation });
  }, [onChange, settings, supportsOperationEdit, supportsOperationExtend]);
  const inheritSettings =
    settings.operation !== "generate" &&
    Boolean(limits.inheritVideoSettingsFor?.includes(settings.operation));
  const omitRatio =
    inheritSettings ||
    (settings.operation !== "generate" &&
      Boolean(
        limits.omitAspectRatioResolutionFor?.includes(settings.operation),
      ));
  return (
    <div className="creation-parameter-editor video">
      {unavailableModelId && (
        <div className="creation-model-warning">
          <b>原模型当前不可用</b>
          <span>{unavailableModelId} 将在重新生成时回退到自动模型。</span>
        </div>
      )}
      <div className="creation-parameter-grid primary">
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
              onChange={(value) => update("model", value)}
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
        <label className="creation-field">
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
        </label>
        {!usesAgnesV20 && <label className="creation-field">
          <small>时长</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            disabled={inheritSettings}
            value={settings.duration}
            onChange={(value) => update("duration", value)}
            options={allowedDurations.map((value) => ({ value, label: `${value} 秒` }))}
            ariaLabel="视频时长"
          />
        </label>}
        {!usesAgnesV20 && <label className="creation-field">
          <small>比例</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            disabled={omitRatio}
            value={settings.aspect}
            onChange={(value) => update("aspect", value)}
            options={VIDEO_RATIOS.map((value) => ({
              value,
              label: value === "auto" ? "自动" : value,
              description: ratioDescriptions[value],
            }))}
            ariaLabel="视频比例"
          />
        </label>}
        {!usesAgnesV20 && <label className="creation-field">
          <small>分辨率</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            disabled={omitRatio}
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
        <label className="creation-field creation-toggle">
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
        </label>
      </div>
      {usesAgnesV20 && (
        canvasCompact ? (
          <div className={`video-option-segment video-v20-parameter-panel video-v20-parameter-panel-canvas${agnesV20PanelOpen ? " open" : ""}`}>
            <button
              type="button"
              className="video-v20-parameter-trigger"
              aria-expanded={agnesV20PanelOpen}
              aria-controls="canvas-video-v20-parameter-drawer"
              onClick={() => setAgnesV20PanelOpen((value) => !value)}
            >
              <span>
                <b>Agnes V2.0 参数</b>
                <small>{agnesV20ParameterSummary}</small>
              </span>
              <i aria-hidden="true">{agnesV20PanelOpen ? "⌃" : "⌄"}</i>
            </button>
            {agnesV20PanelOpen && (
              <div className="video-v20-parameter-drawer" id="canvas-video-v20-parameter-drawer" role="region" aria-label="Agnes V2.0 参数">
                {agnesV20ParameterContent}
              </div>
            )}
          </div>
        ) : (
          <div className="video-option-segment video-v20-parameter-panel">
            {agnesV20ParameterContent}
          </div>
        )
      )}
      {(limits.notes.length > 0 || inheritSettings || omitRatio) && (
        <div className="creation-model-notes">
          <b>
            {inheritSettings
              ? "参数沿用输入视频"
              : omitRatio
                ? "比例与分辨率沿用输入"
                : "当前模型限制"}
          </b>
          <span>
            {limits.notes.join(" · ") || "当前操作不会提交自定义比例和分辨率。"}
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
                label: "智能判断",
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
      variant={variant}
      portalZIndex={portalZIndex}
      dialogPortalZIndex={dialogPortalZIndex}
      onChange={onChange}
    />
  );
}

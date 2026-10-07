"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DEFAULT_CINEMATIC_OPENING_SETTINGS,
  type CinematicOpeningSettings,
} from "@/lib/cinematic-shock-opening-director";
import {
  AGNES_V20_DEFAULT_PARAMS,
  AGNES_V20_DIMENSION_PRESETS,
  AGNES_V20_DURATION_PRESETS,
  videoModelOptions,
} from "@/lib/creation/settings";
import type { CanvasRuntimeState } from "@/lib/canvas/types";
import SelectMenu from "@/components/SelectMenu";
import { allRatios, getVideoModelLimits } from "@/lib/video-model-limits";

const WOW_LABELS = ["克制", "高级", "炫酷", "惊艳", "极限"] as const;

export type OneClickCinematicVideoSelection = {
  providerId: string;
  modelId: string;
  resolution: string;
  agnesWidth?: number;
  agnesHeight?: number;
  agnesNumFrames?: number;
  agnesFrameRate?: number;
};

export default function OneClickCinematicPanel({
  imageUrl,
  imageName,
  runtime,
  onCancel,
  onSubmit,
}: {
  imageUrl: string;
  imageName?: string;
  runtime: CanvasRuntimeState | null;
  onCancel: () => void;
  onSubmit: (
    settings: CinematicOpeningSettings,
    selection: OneClickCinematicVideoSelection,
  ) => void;
}) {
  const [settings, setSettings] = useState(DEFAULT_CINEMATIC_OPENING_SETTINGS);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [resolution, setResolution] = useState("720p");
  const [agnesWidth, setAgnesWidth] = useState<number>(AGNES_V20_DEFAULT_PARAMS.width);
  const [agnesHeight, setAgnesHeight] = useState<number>(AGNES_V20_DEFAULT_PARAMS.height);
  const [agnesNumFrames, setAgnesNumFrames] = useState<number>(AGNES_V20_DEFAULT_PARAMS.numFrames);
  const [agnesFrameRate, setAgnesFrameRate] = useState<number>(AGNES_V20_DEFAULT_PARAMS.frameRate);
  const [selectionError, setSelectionError] = useState("");
  const availableModels = useMemo(() => videoModelOptions(runtime), [runtime]);
  const providerOptions = useMemo(() => {
    const providers = new Map<string, { id: string; name: string; count: number }>();
    for (const model of availableModels) {
      const current = providers.get(model.providerId);
      providers.set(model.providerId, {
        id: model.providerId,
        name: model.providerName,
        count: (current?.count || 0) + 1,
      });
    }
    return [...providers.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [availableModels]);
  const providerModels = useMemo(
    () => availableModels.filter((model) => model.providerId === providerId),
    [availableModels, providerId],
  );
  const selectedModel = providerModels.find((model) => model.id === modelId);
  const selectedProvider = runtime?.providers.find((provider) => provider.id === selectedModel?.providerId);
  const modelLimits = useMemo(
    () => getVideoModelLimits(selectedModel, selectedProvider),
    [selectedModel?.displayName, selectedModel?.rawId, selectedProvider?.id, selectedProvider?.platform, selectedProvider?.videoTransport],
  );
  const usesAgnesV20 = Boolean(selectedModel && /agnes(?: video)?[- ]?v2\.0/i.test(`${selectedModel.rawId} ${selectedModel.displayName}`));
  const durationValues = useMemo(() => {
    if (usesAgnesV20) return AGNES_V20_DURATION_PRESETS.map((preset) => Math.max(1, Math.round(preset.frames / preset.frameRate)));
    if (modelLimits.fixedSeconds) return [modelLimits.fixedSeconds];
    return (modelLimits.allowedSeconds || Array.from({ length: Math.max(0, modelLimits.maxSeconds - modelLimits.minSeconds + 1) }, (_, index) => modelLimits.minSeconds + index))
      .filter((value) => value >= modelLimits.minSeconds && value <= modelLimits.maxSeconds);
  }, [modelLimits, usesAgnesV20]);
  const durationOptions = useMemo(() => [
    { value: "auto" as const, label: "自动", description: usesAgnesV20 ? "按 Agnes 帧数预设" : "按当前模型推荐时长" },
    ...durationValues.map((value) => ({ value, label: `${value} 秒`, description: modelLimits.fixedSeconds === value ? "模型固定时长" : undefined })),
  ], [durationValues, modelLimits.fixedSeconds, usesAgnesV20]);
  const resolutionOptions = useMemo(
    () => modelLimits.resolutions.map((value) => ({ value, label: value, description: value === "480p" ? "快速生成" : value.toLowerCase() === "1080p" ? "高清" : "推荐" })),
    [modelLimits.resolutions],
  );
  const ratioOptions = useMemo(() => [
    { value: "project" as const, label: "跟随项目", description: "根据参考图比例生成" },
    ...allRatios.map((value) => ({
      value: value as Exclude<CinematicOpeningSettings["aspectRatio"], "project">,
      label: value === "auto" ? "Auto" : value,
      description: value === "auto" ? "由模型决定" : value.split(":")[0] === value.split(":")[1] ? "方形" : Number(value.split(":")[0]) > Number(value.split(":")[1]) ? "横屏" : "竖屏",
    })),
  ], []);

  useEffect(() => {
    if (!resolutionOptions.some((option) => option.value === resolution)) setResolution(resolutionOptions[0]?.value || "720p");
  }, [resolution, resolutionOptions]);

  useEffect(() => {
    if (providerId && !providerOptions.some((provider) => provider.id === providerId)) {
      setProviderId("");
      setModelId("");
      return;
    }
    if (modelId && !providerModels.some((model) => model.id === modelId)) setModelId("");
  }, [modelId, providerId, providerModels, providerOptions]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedModel || selectedModel.providerId !== providerId) {
      setSelectionError("请先选择服务商和视频模型，再生成样片。");
      return;
    }
    setSelectionError("");
    const autoDuration = usesAgnesV20
      ? Math.max(1, Math.round(AGNES_V20_DEFAULT_PARAMS.numFrames / AGNES_V20_DEFAULT_PARAMS.frameRate))
      : 8;
    const requestedDuration = settings.duration === "auto" ? autoDuration : Number(settings.duration);
    const duration = durationValues.length
      ? durationValues.reduce((closest, value) => Math.abs(value - requestedDuration) < Math.abs(closest - requestedDuration) ? value : closest, durationValues[0])
      : requestedDuration;
    const submittedSettings = { ...settings, duration };
    onSubmit(
      { ...submittedSettings, userDirection: settings.userDirection.trim() },
      {
        providerId: selectedModel.providerId,
        modelId: selectedModel.id,
        resolution: resolutionOptions.some((option) => option.value === resolution) ? resolution : resolutionOptions[0]?.value || "720p",
        ...(usesAgnesV20 ? { agnesWidth, agnesHeight, agnesNumFrames, agnesFrameRate } : {}),
      },
    );
  }

  return (
    <div className="canvas-modal-backdrop canvas-one-click-backdrop" onClick={onCancel}>
      <form
        className="canvas-one-click-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-one-click-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="canvas-one-click-head">
          <div className="canvas-one-click-title-wrap">
            <span className="canvas-one-click-icon" aria-hidden="true">✦</span>
            <div>
              <h2 id="canvas-one-click-title">一键成片</h2>
              <p>AI 将自动分析参考图并设计适合它的电影级开场镜头。</p>
            </div>
          </div>
          <button type="button" className="canvas-one-click-close" aria-label="关闭一键成片设置" onClick={onCancel}>×</button>
        </header>

        <div className="canvas-one-click-body">
          <div className="canvas-one-click-reference">
            <img src={imageUrl} alt={imageName || "当前参考图"} />
            <div><b>当前参考图</b><small>{imageName || "图片节点素材"}</small></div>
          </div>

          <section className="canvas-one-click-model-selection" aria-labelledby="canvas-one-click-model-title">
            <div className="canvas-one-click-model-head">
              <div>
                <b id="canvas-one-click-model-title">出片引擎</b>
                <small>请明确选择服务商和视频模型，确认后才会提交视频任务。</small>
              </div>
              <span>必选</span>
            </div>
            <div className="canvas-one-click-model-grid">
              <label className="canvas-one-click-model-field">
                <span>服务商</span>
                <SelectMenu
                  value={providerId}
                  ariaLabel="一键成片服务商"
                  disabled={!providerOptions.length}
                  menuWidth={320}
                  options={[
                    { value: "", label: "请选择服务商" },
                    ...providerOptions.map((provider) => ({ value: provider.id, label: provider.name, description: `${provider.count} 个视频模型` })),
                  ]}
                  onChange={(value) => {
                    setProviderId(String(value));
                    setModelId("");
                    setSelectionError("");
                  }}
                />
              </label>
              <label className="canvas-one-click-model-field">
                <span>视频模型</span>
                <SelectMenu
                  value={modelId}
                  ariaLabel="一键成片视频模型"
                  disabled={!providerId || !providerModels.length}
                  menuWidth={380}
                  options={[
                    { value: "", label: providerId ? "请选择视频模型" : "请先选择服务商" },
                    ...providerModels.map((model) => ({ value: model.id, label: model.displayName, description: model.rawId })),
                  ]}
                  onChange={(value) => {
                    setModelId(String(value));
                    setSelectionError("");
                  }}
                />
              </label>
            </div>
            {selectedModel ? (
              <small className="canvas-one-click-model-confirm">已选择：{selectedModel.providerName} · {selectedModel.displayName}</small>
            ) : (
              <small className="canvas-one-click-model-hint">
                {!availableModels.length
                  ? runtime ? "模型库中暂无已启用的视频模型，请先在模型库配置服务商。" : "正在读取视频模型列表…"
                  : "仅显示模型库中已启用且已发布的视频模型。"}
              </small>
            )}
            {selectionError && <small className="canvas-one-click-model-error" role="alert">{selectionError}</small>}
          </section>

          <section className="canvas-one-click-video-params" aria-labelledby="canvas-one-click-video-params-title">
            <div className="canvas-one-click-section-head">
              <div><b id="canvas-one-click-video-params-title">视频参数</b><small>与视频节点一致，选项会按已选模型自动适配。</small></div>
              {selectedModel && <span>{usesAgnesV20 ? "V2.0 专属" : `${modelLimits.resolutions.join(" / ")}`}</span>}
            </div>
            {!usesAgnesV20 && <div className="canvas-one-click-video-param-grid">
              <label className="canvas-one-click-field">
                <span><b>时长</b><small>{modelLimits.fixedSeconds ? "模型固定" : "可选时长"}</small></span>
                <SelectMenu
                  value={settings.duration}
                  ariaLabel="一键成片视频时长"
                  disabled={!selectedModel}
                  options={durationOptions}
                  menuWidth={220}
                  onChange={(value) => setSettings((current) => ({ ...current, duration: value === "auto" ? "auto" : Number(value) }))}
                />
              </label>
              <label className="canvas-one-click-field">
                <span><b>比例</b><small>画面构图</small></span>
                <SelectMenu
                  value={settings.aspectRatio}
                  ariaLabel="一键成片视频比例"
                  disabled={!selectedModel}
                  options={ratioOptions}
                  menuWidth={220}
                  onChange={(value) => setSettings((current) => ({ ...current, aspectRatio: value }))}
                />
              </label>
              <label className="canvas-one-click-field">
                <span><b>分辨率</b><small>清晰度 / 速度</small></span>
                <SelectMenu
                  value={resolution}
                  ariaLabel="一键成片视频分辨率"
                  disabled={!selectedModel || !resolutionOptions.length}
                  options={resolutionOptions}
                  menuWidth={220}
                  onChange={setResolution}
                />
              </label>
            </div>}
            {usesAgnesV20 && <div className="canvas-one-click-v20-params">
              <div className="canvas-one-click-v20-presets">
                <span>快速选时长</span>
                <div role="group" aria-label="一键成片 Agnes V2.0 时长预设">
                  {AGNES_V20_DURATION_PRESETS.map((preset) => {
                    const value = Math.max(1, Math.round(preset.frames / preset.frameRate));
                    const active = agnesNumFrames === preset.frames && agnesFrameRate === preset.frameRate;
                    return <button key={preset.frames} type="button" className={active ? "selected" : ""} onClick={() => { setAgnesNumFrames(preset.frames); setAgnesFrameRate(preset.frameRate); setSettings((current) => ({ ...current, duration: value })); }}><b>{preset.label}</b><small>{preset.frames} 帧 / {preset.frameRate} FPS</small></button>;
                  })}
                </div>
              </div>
              <div className="canvas-one-click-v20-presets">
                <span>快速选画幅</span>
                <div role="group" aria-label="一键成片 Agnes V2.0 画幅预设">
                  {AGNES_V20_DIMENSION_PRESETS.map((preset) => <button key={preset.label} type="button" className={agnesWidth === preset.width && agnesHeight === preset.height ? "selected" : ""} onClick={() => { setAgnesWidth(preset.width); setAgnesHeight(preset.height); }}><b>{preset.label}</b><small>{preset.width} × {preset.height}</small></button>)}
                </div>
              </div>
              <div className="canvas-one-click-v20-custom">
                <span>高级自定义</span><small>宽高须为 64 的倍数；帧数须满足 8n + 1。</small>
                <div>
                  <label>宽度（px）<input aria-label="一键成片宽度" type="number" min={64} max={3840} step={64} value={agnesWidth} onChange={(event) => setAgnesWidth(Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
                  <label>高度（px）<input aria-label="一键成片高度" type="number" min={64} max={3840} step={64} value={agnesHeight} onChange={(event) => setAgnesHeight(Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
                  <label>帧数（8n+1）<input aria-label="一键成片帧数" type="number" min={1} max={441} step={8} value={agnesNumFrames} onChange={(event) => { const next = Math.max(1, Math.min(441, Math.round((Number(event.target.value) || 1) / 8) * 8 + 1)); setAgnesNumFrames(next); setSettings((current) => ({ ...current, duration: Math.max(1, Math.round(next / Math.max(1, agnesFrameRate))) })); }} /></label>
                  <label>帧率（FPS）<input aria-label="一键成片帧率" type="number" min={1} max={60} step={1} value={agnesFrameRate} onChange={(event) => { const next = Math.max(1, Math.min(60, Number(event.target.value) || 1)); setAgnesFrameRate(next); setSettings((current) => ({ ...current, duration: Math.max(1, Math.round(agnesNumFrames / next)) })); }} /></label>
                </div>
              </div>
              <small className="canvas-one-click-parameter-help">预计时长约 {(agnesNumFrames / Math.max(1, agnesFrameRate)).toFixed(1)} 秒（按帧数 ÷ 帧率估算）</small>
            </div>}
            {selectedModel && modelLimits.notes.length > 0 && <small className="canvas-one-click-model-limits">{modelLimits.notes.slice(0, 2).join(" · ")}</small>}
          </section>

          <div className="canvas-one-click-field canvas-one-click-wow">
            <div className="canvas-one-click-field-label"><b>炫酷程度</b><strong>{settings.wowLevel} · {WOW_LABELS[settings.wowLevel - 1]}</strong></div>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={settings.wowLevel}
              aria-label="炫酷程度"
              onChange={(event) => setSettings((current) => ({ ...current, wowLevel: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 }))}
            />
            <div className="canvas-one-click-wow-scale"><span>克制</span><span>高级</span><span>炫酷</span><span>惊艳</span><span>极限</span></div>
          </div>

          <fieldset className="canvas-one-click-field canvas-one-click-mode">
            <legend>镜头模式</legend>
            <div>
              {([["auto", "自动"], ["one_take", "一镜到底"], ["montage", "电影蒙太奇"]] as const).map(([value, label]) => (
                <label key={value} className={settings.directingMode === value ? "active" : ""}>
                  <input type="radio" name="cinematic-mode" value={value} checked={settings.directingMode === value} onChange={() => setSettings((current) => ({ ...current, directingMode: value }))} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <details className="canvas-one-click-advanced">
            <summary>高级设置</summary>
            <div className="canvas-one-click-advanced-body">
              <label><span>创意自由度</span><SelectMenu value={settings.creativity} ariaLabel="一键成片创意自由度" options={[{ value: "strict", label: "严格参考", description: "尽量保持原图主体和构图" }, { value: "balanced", label: "适度发挥", description: "在一致性与戏剧性之间平衡" }, { value: "bold", label: "大胆创作", description: "允许更强的镜头和空间变化" }]} menuWidth={300} onChange={(value) => setSettings((current) => ({ ...current, creativity: value }))} /></label>
              <label><span>自定义要求</span><textarea value={settings.userDirection} aria-label="自定义要求" placeholder="例如：镜头更快、强调产品材质、不要改变人物表情……" rows={3} onChange={(event) => setSettings((current) => ({ ...current, userDirection: event.target.value }))} /></label>
            </div>
          </details>
        </div>

        <footer className="canvas-one-click-footer">
          <button type="button" className="secondary" onClick={onCancel}>取消</button>
          <button type="submit" className="primary" disabled={!selectedModel}>确认并生成样片</button>
        </footer>
      </form>
    </div>
  );
}

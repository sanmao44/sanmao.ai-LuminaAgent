"use client";

import { useEffect, useState } from "react";
import SelectMenu from "@/components/SelectMenu";
import type { CanvasRuntimeState, CanvasUpscaleParams } from "@/lib/canvas/types";
import { loadImageDimensions, upscaleTargetDimensions } from "@/lib/canvas/upscale";

export type CanvasUpscaleSettingsPanelProps = {
  params: CanvasUpscaleParams;
  runtime: CanvasRuntimeState | null;
  sourceUrl?: string;
  portalZIndex?: number;
  onChange: (params: CanvasUpscaleParams) => void;
};

export default function CanvasUpscaleSettingsPanel({
  params,
  runtime,
  sourceUrl,
  portalZIndex = 1000,
  onChange,
}: CanvasUpscaleSettingsPanelProps) {
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceSizeError, setSourceSizeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSourceSize(null);
    setSourceSizeError(false);
    if (!sourceUrl) return () => { cancelled = true; };
    void loadImageDimensions(sourceUrl)
      .then((size) => { if (!cancelled) setSourceSize(size); })
      .catch(() => { if (!cancelled) setSourceSizeError(true); });
    return () => { cancelled = true; };
  }, [sourceUrl]);
  const legacyModels = (runtime?.models || []).filter((model) => model.enabled && model.published && (model.capabilities || []).includes("upscale"));
  const cloudModels = runtime?.upscaleModels || [];
  const models = [
    ...legacyModels,
    ...cloudModels.filter((model) => !legacyModels.some((legacy) => legacy.id === model.id)),
  ];
  const selectedModelRecord = params.model !== "auto"
    ? models.find((model) => model.id === params.model)
    : cloudModels.find((model) => model.connected && model.id === "tencent-super-resolution")
      || cloudModels.find((model) => model.connected && model.id === "aliyun-standard-super-resolution")
      || legacyModels[0];
  const selectedCloudModel = selectedModelRecord && "provider" in selectedModelRecord ? selectedModelRecord : null;
  const isCloudModel = selectedCloudModel?.provider === "tencent-ci" || selectedCloudModel?.provider === "aliyun-viapi";
  const supportedScales = selectedCloudModel?.scales || [1, 2, 3, 4] as const;
  const selectedOutputQuality = selectedCloudModel?.outputQuality;
  const target = sourceSize ? upscaleTargetDimensions(sourceSize, params.scale, selectedCloudModel, params.target) : null;
  const modelOptions = [
    { value: "auto", label: "自动选择", description: "使用默认厂商，失败时自动回退" },
    ...models.map((model) => ({ value: model.id, label: model.displayName, description: `${model.providerName} · ${model.rawId}` })),
  ];
  const colorCorrectionOptions: Array<{ value: CanvasUpscaleParams["colorCorrection"]; label: string }> = [
    { value: "wavelet", label: "wavelet · 接近原图" },
    { value: "none", label: "关闭" },
  ];
  const algorithmOptions: Array<{ value: CanvasUpscaleParams["algorithm"]; label: string }> = [
    { value: "lanczos", label: "lanczos · 锐利" },
    { value: "bicubic", label: "bicubic · 平滑" },
    { value: "nearest", label: "nearest · 像素" },
  ];
  return (
    <div className="canvas-upscale-settings" aria-label="超分设置">
      <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>模型</strong></div>
          <SelectMenu
            value={params.model}
            portalZIndex={portalZIndex}
            onChange={(value) => {
              const next = models.find((model) => model.id === value);
              const nextCloud = next && "provider" in next ? next : null;
              const nextScales = nextCloud?.scales || [1, 2, 3, 4] as const;
              onChange({ ...params, model: value, scale: nextScales.includes(params.scale) ? params.scale : nextScales.includes(2) ? 2 : nextScales[0], ...(nextCloud?.outputFormats?.includes(params.outputFormat || "png") ? {} : { outputFormat: nextCloud?.outputFormats?.[0] || "png" }) });
            }}
            ariaLabel="模型" className="canvas-upscale-select" menuClassName="canvas-upscale-select-popover" options={modelOptions}
          />
        </div>
        <div className="canvas-upscale-field">
          <div className="canvas-upscale-field-label"><strong>放大倍率</strong></div>
          <div className="canvas-upscale-scale-options">{supportedScales.map((scale) => <button key={scale} type="button" className={params.scale === scale ? "active" : ""} aria-pressed={params.scale === scale} aria-label={`${scale}×`} onClick={() => onChange({ ...params, scale: scale as CanvasUpscaleParams["scale"] })}>{scale}×</button>)}</div>
        </div>
      </div>
      <div className="canvas-upscale-size-readout"><span><small>原图</small><strong>{sourceSize ? `${sourceSize.width}×${sourceSize.height}` : sourceSizeError ? "读取失败" : "读取中…"}</strong></span><b>→</b><span><small>{isCloudModel ? "输出" : "目标"}</small><strong>{target ? `${target.width}×${target.height}` : sourceSizeError ? "无法计算" : "计算中…"}</strong></span></div>
      {!isCloudModel && <div className="canvas-upscale-setting-row">
        <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>随机种子</strong></span><input type="number" min={0} value={params.seed} aria-label="随机种子" onChange={(event) => onChange({ ...params, seed: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
        <div className="canvas-upscale-field"><div className="canvas-upscale-field-label"><strong>颜色校正</strong></div><SelectMenu value={params.colorCorrection} portalZIndex={portalZIndex} onChange={(value) => onChange({ ...params, colorCorrection: value })} ariaLabel="颜色校正" className="canvas-upscale-select" menuClassName="canvas-upscale-select-popover" options={[...colorCorrectionOptions]} /></div>
      </div>}
      {!isCloudModel && <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field"><div className="canvas-upscale-field-label"><strong>缩放算法</strong></div><SelectMenu value={params.algorithm} portalZIndex={portalZIndex} onChange={(value) => onChange({ ...params, algorithm: value })} ariaLabel="缩放算法" className="canvas-upscale-select" menuClassName="canvas-upscale-select-popover" options={[...algorithmOptions]} /></div>
        <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>可选说明</strong></span><input value={params.prompt || ""} aria-label="可选说明" placeholder="SeedVR2 超分不会根据提示词修改画面…" onChange={(event) => onChange({ ...params, prompt: event.target.value })} /></label>
      </div>}
      {isCloudModel && selectedCloudModel?.outputFormats && <div className="canvas-upscale-setting-row">
        <div className="canvas-upscale-field"><div className="canvas-upscale-field-label"><strong>输出格式</strong></div><SelectMenu value={params.outputFormat || selectedCloudModel.outputFormats[0]} portalZIndex={portalZIndex} onChange={(value) => onChange({ ...params, outputFormat: value as CanvasUpscaleParams["outputFormat"] })} ariaLabel="输出格式" className="canvas-upscale-select" menuClassName="canvas-upscale-select-popover" options={selectedCloudModel.outputFormats.map((value) => ({ value, label: value.toUpperCase() }))} /></div>
        {selectedOutputQuality && (params.outputFormat || selectedCloudModel.outputFormats[0]) === "jpg" && <label className="canvas-upscale-field"><span className="canvas-upscale-field-label"><strong>JPG 质量</strong></span><input type="number" min={selectedOutputQuality.min} max={selectedOutputQuality.max} value={params.outputQuality || selectedOutputQuality.default} aria-label="JPG 质量" onChange={(event) => onChange({ ...params, outputQuality: Math.max(selectedOutputQuality.min, Math.min(selectedOutputQuality.max, Math.round(Number(event.target.value) || selectedOutputQuality.default))) })} /></label>}
      </div>}
      {isCloudModel && <small className="canvas-upscale-model-note">{selectedCloudModel?.provider === "tencent-ci" ? "腾讯云官方参数：仅支持 1×、2×、4×，不提供种子、颜色校正或缩放算法。" : selectedCloudModel?.generative ? "阿里云生成式超分：会重新生成部分细节，可能改变原图内容；任务将在后台处理。" : "阿里云标准超分：可选择输出格式，JPG 可调整质量。"}</small>}
      {!sourceUrl && <small className="canvas-upscale-empty-hint">请连接一张已完成的图片后再提交</small>}
    </div>
  );
}

"use client";

import { useState } from "react";
import SelectMenu from "@/components/SelectMenu";
import type { CangyuanImageModelProfile } from "@/lib/cangyuan-image-capabilities";
import type { ImageCreationSettings } from "@/lib/creation/settings";
import CangyuanMediaUploadField from "./CangyuanMediaUploadField";
import "./CangyuanImageModelOptions.css";

type Props = {
  profile: CangyuanImageModelProfile;
  settings: ImageCreationSettings;
  referenceCount: number;
  onChange: (settings: ImageCreationSettings) => void;
  portalZIndex?: number;
};

const booleanOptions = [
  { value: "default", label: "模型默认" },
  { value: "on", label: "开启" },
  { value: "off", label: "关闭" },
];

function booleanValue(value: boolean | undefined) {
  return value === undefined ? "default" : value ? "on" : "off";
}

function parseBooleanValue(value: string) {
  return value === "default" ? undefined : value === "on";
}

export default function CangyuanImageModelOptions({
  profile,
  settings,
  referenceCount,
  onChange,
  portalZIndex,
}: Props) {
  const [markupUploading, setMarkupUploading] = useState(false);
  const showLayerOptions = profile.supportsLayerDecomposition && settings.layerDecomposition === true;
  const hasParameter = (name: NonNullable<CangyuanImageModelProfile["advancedParameters"]>[number]) =>
    profile.advancedParameters?.includes(name) === true;
  const hasAdvancedOptions = Boolean(
    profile.supportsSeed
    || profile.supportsSafetyIdentifier
    || profile.advancedParameters?.length,
  );

  return (
    <div className="cangyuan-image-model-options">
      {profile.supportsStyle && (
        <label className="creation-field cangyuan-image-wide-field">
          <small>风格偏好</small>
          <input
            className="creation-field-input"
            type="text"
            value={settings.style || ""}
            onChange={(event) => onChange({ ...settings, style: event.target.value || undefined })}
            placeholder="例如：写实、动漫、电影感"
            autoComplete="off"
          />
        </label>
      )}

      {(profile.supportsNegativePrompt || profile.supportsNoParameter) && (
        <label className="creation-field cangyuan-image-wide-field">
          <small>{profile.supportsNoParameter ? "排除内容" : "不希望出现"}</small>
          <textarea
            value={settings.negativePrompt || ""}
            onChange={(event) => onChange({ ...settings, negativePrompt: event.target.value || undefined })}
            placeholder="描述需要避免的内容"
            rows={2}
          />
        </label>
      )}

      {profile.supportsLayerDecomposition && (
        <>
          <label className="creation-field creation-toggle cangyuan-image-wide-field">
            <small>分层输出</small>
            <button
              type="button"
              className={settings.layerDecomposition ? "active" : ""}
              aria-pressed={Boolean(settings.layerDecomposition)}
              onClick={() => onChange({
                ...settings,
                layerDecomposition: !settings.layerDecomposition,
                count: settings.layerDecomposition ? settings.count : 1,
                ...(settings.layerDecomposition || settings.backgroundMode !== "api-transparent"
                  ? {}
                  : { backgroundMode: "auto" as const }),
              })}
            >
              <span>{settings.layerDecomposition ? "单张分层" : "普通图片"}</span>
              <i />
            </button>
          </label>
          {showLayerOptions && (
            <div className="cangyuan-image-nested-options cangyuan-image-wide-field">
              <label className="creation-field">
                <small>分层结果上限</small>
                <input
                  className="creation-field-input"
                  type="number"
                  min={2}
                  max={100}
                  step={1}
                  value={settings.layerMaxImages ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    const parsed = value === "" ? undefined : Math.max(2, Math.min(100, Math.round(Number(value))));
                    onChange({ ...settings, layerMaxImages: parsed });
                  }}
                  placeholder="模型自动决定"
                />
                <em>总数包含底图与图层，且会影响计费</em>
              </label>
              <label className="creation-field">
                <small>文字识别</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={booleanValue(settings.layerTextRecognition)}
                  onChange={(value) => onChange({ ...settings, layerTextRecognition: parseBooleanValue(value) })}
                  options={booleanOptions}
                  ariaLabel="图层文字识别"
                />
              </label>
            </div>
          )}
        </>
      )}

      {profile.supportsPromptOptimization && (
        <label className="creation-field creation-toggle cangyuan-image-wide-field">
          <small>提示词优化</small>
          <button
            type="button"
            className={settings.optimizePrompt ? "active" : ""}
            aria-pressed={Boolean(settings.optimizePrompt)}
            title="启用模型提供的标准提示词优化"
            onClick={() => onChange({ ...settings, optimizePrompt: !settings.optimizePrompt })}
          >
            <span>{settings.optimizePrompt ? "自动优化" : "按原文生成"}</span>
            <i />
          </button>
        </label>
      )}

      {profile.requiresReference && referenceCount < 1 && (
        <p className="cangyuan-image-inline-warning cangyuan-image-wide-field">
          此模型需要至少一张参考图才能生成。
        </p>
      )}

      {hasAdvancedOptions && (
        <details className="cangyuan-image-advanced cangyuan-image-wide-field">
          <summary>细节控制</summary>
          <div className="cangyuan-image-advanced-grid">
            {profile.supportsSeed && (
              <label className="creation-field">
                <small>随机种子</small>
                <input
                  className="creation-field-input"
                  type="text"
                  inputMode="numeric"
                  value={settings.seed || ""}
                  maxLength={profile.seedMaximum ? String(profile.seedMaximum).length : undefined}
                  onChange={(event) => onChange({ ...settings, seed: event.target.value || undefined })}
                  placeholder="每次随机"
                  autoComplete="off"
                />
                <em>填入整数可复现相近构图</em>
              </label>
            )}

            {hasParameter("output_compression") && settings.outputFormat !== "png" && settings.outputFormat !== "gif" && settings.outputFormat !== "svg" && (
              <label className="creation-field">
                <small>图片压缩</small>
                <input
                  className="creation-field-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.outputCompression ?? 100}
                  onChange={(event) => {
                    const value = event.target.value;
                    onChange({ ...settings, outputCompression: value === "" ? undefined : Number(value) });
                  }}
                />
                <em>仅 JPEG / WebP 生效，数值越高画质越好</em>
              </label>
            )}

            {hasParameter("moderation") && (
              <label className="creation-field">
                <small>内容审核</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.moderation || "default"}
                  onChange={(value) => onChange({ ...settings, moderation: value === "default" ? undefined : value as "auto" | "low" })}
                  options={[
                    { value: "default", label: "模型默认" },
                    { value: "auto", label: "标准" },
                    { value: "low", label: "较宽松" },
                  ]}
                  ariaLabel="内容审核"
                />
              </label>
            )}

            {hasParameter("complexity") && (
              <label className="creation-field">
                <small>构图规划</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.complexity || "default"}
                  onChange={(value) => onChange({ ...settings, complexity: value === "default" ? undefined : value as "low" | "medium" | "high" })}
                  options={[
                    { value: "default", label: "模型默认" },
                    { value: "low", label: "简洁" },
                    { value: "medium", label: "均衡" },
                    { value: "high", label: "精细" },
                  ]}
                  ariaLabel="构图规划"
                />
              </label>
            )}

            {settings.outputFormat === "gif" && hasParameter("frame_count") && (
              <label className="creation-field">
                <small>动画帧数</small>
                <input className="creation-field-input" type="number" min={2} max={16} step={1} value={settings.frameCount ?? 9}
                  onChange={(event) => onChange({ ...settings, frameCount: event.target.value === "" ? undefined : Number(event.target.value) })} />
              </label>
            )}

            {settings.outputFormat === "gif" && hasParameter("frame_duration_ms") && (
              <label className="creation-field">
                <small>单帧时长（毫秒）</small>
                <input className="creation-field-input" type="number" min={20} max={2000} step={10} value={settings.frameDurationMs ?? 200}
                  onChange={(event) => onChange({ ...settings, frameDurationMs: event.target.value === "" ? undefined : Number(event.target.value) })} />
              </label>
            )}

            {hasParameter("chaos") && (
              <label className="creation-field">
                <small>画面变化幅度</small>
                <input className="creation-field-input" type="number" min={0} max={100} step={1} value={settings.chaos ?? ""}
                  onChange={(event) => onChange({ ...settings, chaos: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {hasParameter("exp") && (
              <label className="creation-field">
                <small>实验风格强度</small>
                <input className="creation-field-input" type="number" min={0} max={100} step={1} value={settings.experimentalStyle ?? ""}
                  onChange={(event) => onChange({ ...settings, experimentalStyle: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {hasParameter("hd") && (
              <label className="creation-field creation-toggle">
                <small>原生 2K</small>
                <button type="button" className={settings.hd === false ? "" : "active"} aria-pressed={settings.hd !== false}
                  onClick={() => onChange({ ...settings, hd: settings.hd === false ? undefined : false })}>
                  <span>{settings.hd === false ? "标准档" : "2K 档"}</span><i />
                </button>
                <em>模型默认按 2K 档计费</em>
              </label>
            )}

            {hasParameter("iw") && (
              <label className="creation-field">
                <small>参考图影响力</small>
                <input className="creation-field-input" type="number" min={0} max={3} step={0.1} value={settings.referenceImageWeight ?? ""}
                  onChange={(event) => onChange({ ...settings, referenceImageWeight: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {hasParameter("raw") && (
              <label className="creation-field creation-toggle">
                <small>保留原始风格</small>
                <button type="button" className={settings.rawStyle === false ? "" : "active"} aria-pressed={settings.rawStyle !== false}
                  onClick={() => onChange({ ...settings, rawStyle: settings.rawStyle === false ? undefined : false })}>
                  <span>{settings.rawStyle === false ? "默认修饰" : "原始模式"}</span><i />
                </button>
              </label>
            )}

            {hasParameter("reference") && (
              <label className="creation-field">
                <small>参考图用途</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.referenceMode || "default"}
                  onChange={(value) => onChange({ ...settings, referenceMode: value === "default" ? undefined : value as ImageCreationSettings["referenceMode"] })}
                  options={[
                    { value: "default", label: "自动" },
                    { value: "image", label: "画面内容" },
                    { value: "style", label: "视觉风格" },
                    { value: "edit", label: "局部修改" },
                    { value: "moodboard", label: "情绪参考" },
                    { value: "editor", label: "编辑参考" },
                  ]}
                  ariaLabel="参考图用途"
                />
              </label>
            )}

            {hasParameter("reference_slots") && referenceCount > 4 && (
              <label className="creation-field">
                <small>参考图槽位数</small>
                <input className="creation-field-input" type="number" min={5} max={8} step={1} value={settings.referenceSlots ?? ""}
                  onChange={(event) => onChange({ ...settings, referenceSlots: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="按参考图顺序" />
                <em>超过 4 张参考图时需指定</em>
              </label>
            )}

            {hasParameter("speed") && (
              <label className="creation-field">
                <small>生成速度</small>
                <SelectMenu
                  portalZIndex={portalZIndex}
                  value={settings.speed || "default"}
                  onChange={(value) => onChange({ ...settings, speed: value === "default" ? undefined : value as "relax" | "fast" })}
                  options={[
                    { value: "default", label: "模型默认" },
                    { value: "relax", label: "省积分" },
                    { value: "fast", label: "快速" },
                  ]}
                  ariaLabel="生成速度"
                />
              </label>
            )}

            {hasParameter("stylize") && (
              <label className="creation-field">
                <small>艺术发挥</small>
                <input className="creation-field-input" type="number" min={0} max={1000} step={10} value={settings.stylize ?? ""}
                  onChange={(event) => onChange({ ...settings, stylize: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {hasParameter("sw") && (
              <label className="creation-field">
                <small>风格参考强度</small>
                <input className="creation-field-input" type="number" min={0} max={1000} step={10} value={settings.styleWeight ?? ""}
                  onChange={(event) => onChange({ ...settings, styleWeight: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {hasParameter("weird") && (
              <label className="creation-field">
                <small>非常规风格强度</small>
                <input className="creation-field-input" type="number" min={0} max={3000} step={50} value={settings.weird ?? ""}
                  onChange={(event) => onChange({ ...settings, weird: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="模型默认" />
              </label>
            )}

            {profile.supportsSafetyIdentifier && (
              <label className="creation-field cangyuan-image-wide-field">
                <small>安全追踪标识</small>
                <input
                  className="creation-field-input"
                  type="text"
                  value={settings.safetyIdentifier || ""}
                  maxLength={profile.safetyIdentifierMaxLength || 128}
                  onChange={(event) => onChange({ ...settings, safetyIdentifier: event.target.value || undefined })}
                  placeholder="可留空"
                  autoComplete="off"
                />
                <em>留空时使用服务商默认处理</em>
              </label>
            )}
          </div>
        </details>
      )}

      {profile.supportsWatermarkSetting && (
        <label className="creation-field">
          <small>水印</small>
          <SelectMenu
            portalZIndex={portalZIndex}
            value={booleanValue(settings.watermark)}
            onChange={(value) => onChange({ ...settings, watermark: parseBooleanValue(value) })}
            options={[
              { value: "default", label: "模型默认" },
              { value: "on", label: "添加水印" },
              { value: "off", label: "不添加" },
            ]}
            ariaLabel="图片水印"
          />
        </label>
      )}

      {profile.supportsMarkupImage && (
        <div className="cangyuan-image-wide-field">
          <CangyuanMediaUploadField
            fieldId={`image-markup-${profile.publicModel}`}
            kind="image"
            label="透明标记图"
            value={settings.markupImage || ""}
            onChange={(value) => onChange({ ...settings, markupImage: value || undefined })}
            onUploadingChange={(_fieldId, uploading) => setMarkupUploading(uploading)}
            disabled={markupUploading || referenceCount < 1 || Boolean(settings.mask)}
            accept=".png,image/png"
            requirePng
            maxFileBytes={20 * 1024 * 1024}
            note={referenceCount < 1
              ? "请先添加一张参考图。"
              : settings.mask
                ? "请先移除蒙版。"
                : "仅用于改图；需与第一张参考图同尺寸，并包含透明像素。"}
          />
          {settings.markupImage && (referenceCount < 1 || settings.mask) && (
            <p className="cangyuan-image-inline-warning">
              透明标记图需要首张参考图，并且不能与蒙版同时使用。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

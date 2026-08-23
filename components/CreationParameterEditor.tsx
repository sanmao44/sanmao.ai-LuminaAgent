"use client";

import { useMemo, useState } from "react";
import ModelPicker from "./ModelPicker";
import SelectMenu from "./SelectMenu";
import {
  IMAGE_QUALITY_OPTIONS,
  IMAGE_RATIOS,
  IMAGE_SIZE_TIERS,
  VIDEO_RATIOS,
  type CreationSettings,
  type AgentCreationSettings,
  type ImageCreationSettings,
  type VideoCreationSettings,
} from "@/lib/creation/settings";
import { getVideoModelLimits } from "@/lib/video-model-limits";
import type { ModelCapability, PublicState } from "@/lib/types";

type Props = {
  settings: CreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  referenceCount?: number;
  onChange: (settings: CreationSettings) => void;
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
  onChange,
}: {
  settings: ImageCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  onChange: Props["onChange"];
}) {
  const [advanced, setAdvanced] = useState(false);
  const update = <K extends keyof ImageCreationSettings>(
    key: K,
    value: ImageCreationSettings[K],
  ) => onChange({ ...settings, [key]: value });
  const models = runtime?.models || [];
  const provider = runtime?.providers.find(
    (item) => item.id === runtime.settings.defaultProviderId,
  );
  return (
    <div className="creation-parameter-editor image">
      {unavailableModelId && (
        <div className="creation-model-warning">
          <b>原模型当前不可用</b>
          <span>
            {unavailableModelId}{" "}
            将在重新生成时回退到自动模型，历史快照仍会保留。
          </span>
        </div>
      )}
      <div className="creation-parameter-grid primary">
        <label className="creation-field model">
          <small>图片模型</small>
          <ModelPicker
            models={models}
            value={settings.model}
            capability="generate"
            defaultProviderId={runtime?.settings.defaultProviderId}
            defaultProviderName={provider?.name}
            defaultModelId={runtime?.settings.defaultImageModelId}
            onChange={(value) => update("model", value)}
          />
        </label>
        <label className="creation-field">
          <small>比例</small>
          <SelectMenu
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
            value={settings.count}
            onChange={(value) => update("count", value)}
            options={[1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({
              value,
              label: `${value} 张`,
            }))}
            ariaLabel="生成数量"
          />
        </label>
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
        title={advanced ? "收起高级图片参数" : "展开质量、格式与背景参数"}
      >
        <span>{advanced ? "收起" : "高级"}</span>
        <small>质量、格式与背景</small>
        <b>{advanced ? "⌃" : "⌄"}</b>
      </button>
      {advanced && (
        <div className="creation-parameter-grid advanced">
          <label className="creation-field">
            <small>质量</small>
            <SelectMenu
              value={settings.quality}
              onChange={(value) => update("quality", value)}
              options={IMAGE_QUALITY_OPTIONS}
              ariaLabel="图片质量"
            />
          </label>
          <label className="creation-field">
            <small>输出格式</small>
            <SelectMenu
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
    </div>
  );
}

function durationValues(
  minimum: number,
  maximum: number,
  fixed?: number,
  allowed?: number[],
) {
  if (fixed) return [fixed];
  if (allowed?.length) return allowed;
  return [
    ...new Set(
      [minimum, 3, 4, 5, 6, 8, 10, 12, 15, 30, maximum].filter(
        (value) => value >= minimum && value <= maximum,
      ),
    ),
  ].sort((left, right) => left - right);
}

function VideoEditor({
  settings,
  runtime,
  unavailableModelId,
  onChange,
}: {
  settings: VideoCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
  onChange: Props["onChange"];
}) {
  const update = <K extends keyof VideoCreationSettings>(
    key: K,
    value: VideoCreationSettings[K],
  ) => onChange({ ...settings, [key]: value });
  const model = runtime?.models.find((item) => item.id === settings.model);
  const provider = runtime?.providers.find(
    (item) => item.id === model?.providerId,
  );
  const limits = useMemo(
    () => getVideoModelLimits(model, provider),
    [model, provider],
  );
  const supports = (capability: ModelCapability) =>
    !model || model.capabilities.includes(capability);
  const operationOptions = [
    {
      value: "generate" as const,
      label: "生成视频",
      description: "根据提示词和画面输入生成",
    },
    ...(supports("video-edit")
      ? [
          {
            value: "edit" as const,
            label: "视频编辑",
            description: "根据已有视频修改",
          },
        ]
      : []),
    ...(supports("video-extend")
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
    ...(supports("video-first-frame")
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
    ...(supports("video-reference")
      ? [
          {
            value: "reference" as const,
            label: "参考图生视频",
            description: `最多 ${limits.maxReferenceImages} 张`,
          },
        ]
      : []),
  ];
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
        <label className="creation-field model">
          <small>视频模型</small>
          <ModelPicker
            models={runtime?.models || []}
            value={settings.model}
            capability="video-generate"
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
        <label className="creation-field">
          <small>操作</small>
          <SelectMenu
            value={settings.operation}
            onChange={(value) => update("operation", value)}
            options={operationOptions}
            ariaLabel="视频操作"
          />
        </label>
        <label className="creation-field">
          <small>生成方式</small>
          <SelectMenu
            value={settings.inputMode}
            onChange={(value) => update("inputMode", value)}
            options={inputOptions}
            ariaLabel="视频生成方式"
          />
        </label>
        <label className="creation-field">
          <small>时长</small>
          <SelectMenu
            disabled={inheritSettings}
            value={settings.duration}
            onChange={(value) => update("duration", value)}
            options={durationValues(
              limits.minSeconds,
              limits.maxSeconds,
              limits.fixedSeconds,
              limits.allowedSeconds,
            ).map((value) => ({ value, label: `${value} 秒` }))}
            ariaLabel="视频时长"
          />
        </label>
        <label className="creation-field">
          <small>比例</small>
          <SelectMenu
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
        </label>
        <label className="creation-field">
          <small>分辨率</small>
          <SelectMenu
            disabled={omitRatio}
            value={settings.resolution}
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
        </label>
        <label className="creation-field creation-toggle">
          <small>原生音频</small>
          <button
            type="button"
            disabled={!supports("video-audio")}
            className={settings.audio ? "active" : ""}
            aria-pressed={settings.audio}
            onClick={() => update("audio", !settings.audio)}
          >
            <span>{settings.audio ? "已开启" : "关闭"}</span>
            <i />
          </button>
        </label>
      </div>
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
}: {
  settings: AgentCreationSettings;
  runtime: PublicState | null;
  unavailableModelId?: string;
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
  onChange,
}: Props) {
  return settings.kind === "video" ? (
    <VideoEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      onChange={onChange}
    />
  ) : settings.kind === "text" ? (
    <AgentEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      onChange={onChange}
    />
  ) : (
    <ImageEditor
      settings={settings}
      runtime={runtime}
      unavailableModelId={unavailableModelId}
      onChange={onChange}
    />
  );
}

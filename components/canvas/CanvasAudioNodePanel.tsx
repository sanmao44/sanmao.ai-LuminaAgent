import { useEffect, useRef, useState } from "react";
import type { CanvasAudioDraft, CanvasAudioGenerationMeta, CanvasNode } from "@/lib/canvas/types";
import type { RegistryModel } from "@/lib/types";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import ModelPicker from "@/components/ModelPicker";

const SPEECH_TEXT_LIMIT = 5000;

export type CanvasAudioNodePanelProps = {
  node: CanvasNode;
  onReplaceAudio: (nodeId: string, file: File, generation?: CanvasAudioGenerationMeta) => Promise<boolean>;
  onSpeechDraftChange: (nodeId: string, draft: CanvasAudioDraft) => void;
  onDurationChange: (nodeId: string, durationSeconds: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  models: RegistryModel[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  projectId?: string;
  canvasId?: string;
};

export default function CanvasAudioNodePanel({
  node,
  onReplaceAudio,
  onSpeechDraftChange,
  onDurationChange,
  onNotify,
  models,
  defaultProviderId,
  defaultProviderName,
  projectId,
  canvasId,
}: CanvasAudioNodePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [speechText, setSpeechText] = useState(() => node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
  const [voice, setVoice] = useState(() => node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
  const [speechModelId, setSpeechModelId] = useState(() => node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const data = node.data;
  const hasAudio = Boolean(data.url);
  const speechServiceLabel = data.speechGeneration?.engine === "offline"
    ? "本机离线语音"
    : data.speechGeneration?.modelName || "尚未生成";

  useEffect(() => {
    setSpeechText(node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
    setVoice(node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
    setSpeechModelId(node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
    setSpeechError("");
  }, [node.id, node.data.speechDraft?.text, node.data.speechDraft?.voice, node.data.speechDraft?.modelId, node.data.speechGeneration?.text, node.data.speechGeneration?.voice, node.data.speechGeneration?.requestedModelId]);

  function saveSpeechDraft(next: Partial<CanvasAudioDraft> = {}) {
    onSpeechDraftChange(node.id, {
      text: next.text ?? speechText,
      voice: next.voice ?? voice,
      modelId: next.modelId ?? speechModelId,
      updatedAt: Date.now(),
    });
  }

  async function generateSpeech() {
    const text = speechText.trim();
    if (!text || generatingSpeech) return;
    setSpeechError("");
    setGeneratingSpeech(true);
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(voice.trim() ? { voice: voice.trim() } : {}),
          ...(speechModelId !== "auto" ? { modelId: speechModelId } : {}),
          source: "canvas",
          ...(projectId ? { projectId } : {}),
          ...(canvasId ? { canvasId } : {}),
          nodeId: node.id,
        }),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(String(body?.error || `配音生成失败（${response.status}）`));
      }
      const blob = await response.blob();
      const rawExtension = response.headers.get("X-Audio-Extension") || "mp3";
      const extension = /^[a-z0-9]{1,8}$/i.test(rawExtension) ? rawExtension : "mp3";
      const file = new File([blob], `AI配音-${Date.now()}.${extension}`, {
        type: blob.type || "audio/mpeg",
      });
      const engine = response.headers.get("X-Audio-Engine") === "offline" ? "offline" : "provider";
      const modelName = response.headers.get("X-Audio-Model")?.trim().slice(0, 120);
      const modelId = response.headers.get("X-Audio-Model-Id")?.trim().slice(0, 160);
      const generation: CanvasAudioGenerationMeta = {
        text,
        engine,
        requestedModelId: speechModelId,
        ...(modelName ? { modelName } : {}),
        ...(modelId ? { modelId } : {}),
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        createdAt: Date.now(),
      };
      const replaced = await onReplaceAudio(node.id, file, generation);
      if (!replaced) setSpeechError("配音已生成，但写入画布失败。原音频保持不变，请重试。");
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "配音生成失败，请稍后重试。");
    } finally {
      setGeneratingSpeech(false);
    }
  }

  async function copySpeechText() {
    const text = speechText.trim();
    if (!text || generatingSpeech) return;
    try {
      await navigator.clipboard.writeText(text);
      onNotify("配音文案已复制");
    } catch {
      onNotify("复制失败，请检查剪贴板权限", "error");
    }
  }

  return (
    <div
      className="canvas-audio-panel"
      data-canvas-wheel-isolate
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="canvas-audio-panel-main">
        <section className="canvas-audio-speech" aria-label="文本转配音">
          <div className="canvas-audio-speech-heading">
            <div>
              <label htmlFor={`canvas-audio-speech-${node.id}`}>文本配音</label>
              <small>旁白、台词或解说词</small>
            </div>
            <div className="canvas-audio-speech-tools">
              <button
                type="button"
                className="canvas-audio-speech-copy"
                onClick={() => void copySpeechText()}
                disabled={!speechText.trim() || generatingSpeech}
                title="复制配音文案"
              >
                复制文案
              </button>
              <small className="canvas-audio-speech-count">{speechText.length} / {SPEECH_TEXT_LIMIT}</small>
            </div>
          </div>
        <textarea
          id={`canvas-audio-speech-${node.id}`}
          value={speechText}
          maxLength={SPEECH_TEXT_LIMIT}
          rows={8}
          placeholder="输入旁白、台词或解说词…"
          onChange={(event) => {
            const text = event.target.value;
            setSpeechText(text);
            setSpeechError("");
            saveSpeechDraft({ text });
          }}
          disabled={generatingSpeech}
        />
        <details className="canvas-audio-advanced">
          <summary>音色设置（可选）</summary>
          <label htmlFor={`canvas-audio-voice-${node.id}`}>音色名称</label>
          <input
            id={`canvas-audio-voice-${node.id}`}
            value={voice}
            maxLength={100}
            placeholder="留空使用默认音色"
            onChange={(event) => {
              const voice = event.target.value;
              setVoice(voice);
              setSpeechError("");
              saveSpeechDraft({ voice });
            }}
            disabled={generatingSpeech}
          />
        </details>
        </section>
        <aside className="canvas-audio-panel-source" aria-label="音频素材与生成记录">
          <div className="canvas-audio-panel-intro">
            <div className="canvas-audio-panel-intro-copy">
              <span className="canvas-audio-panel-icon" aria-hidden="true">♫</span>
              <div>
                <b>音频素材</b>
                <small>试听、替换或连接到视频节点</small>
              </div>
            </div>
            <span className={`canvas-audio-panel-state${hasAudio ? " ready" : " empty"}`}>
              {hasAudio ? "已就绪" : "待导入"}
            </span>
          </div>
          {hasAudio ? (
            <div className="canvas-audio-panel-player">
              <CanvasAudioPlayer
                src={String(data.url)}
                name={String(data.name || "音频素材")}
                onDuration={(duration) => onDurationChange(node.id, duration)}
              />
              <div className="canvas-audio-panel-meta">
                <b title={String(data.name || "音频素材")}>{String(data.name || "音频素材")}</b>
                <div className="canvas-audio-panel-meta-chips">
                  <span>{String(data.mimeType || "audio/*")}</span>
                  <span>{formatCanvasAudioDuration(data.durationMs)}</span>
                  {data.assetId && <span title={String(data.assetId)}>资产 {String(data.assetId)}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="canvas-audio-panel-empty">
              <span>还没有音频</span>
              <small>生成配音或导入素材后，可在此试听</small>
            </div>
          )}
          {data.speechGeneration && (
            <details className="canvas-audio-generation">
              <summary>配音生成记录</summary>
              <p>{data.speechGeneration.text}</p>
              <small>
                {data.speechGeneration.engine === "offline" ? "本机离线语音" : data.speechGeneration.modelName || "在线配音模型"}
                {data.speechGeneration.voice ? ` · ${data.speechGeneration.voice}` : ""}
                {` · ${new Date(data.speechGeneration.createdAt).toLocaleString("zh-CN", { hour12: false })}`}
              </small>
            </details>
          )}
        </aside>
      </div>
      <div className="canvas-audio-panel-actions">
        {speechError && <p className="canvas-audio-error" role="alert">{speechError}</p>}
        <div className="canvas-audio-panel-service" title={speechServiceLabel}>
          <span className="canvas-audio-panel-service-dot" aria-hidden="true" />
          <div>
            <b>配音模型</b>
            <ModelPicker
              models={models}
              capability="speech"
              value={speechModelId}
              onChange={(modelId) => {
                setSpeechModelId(modelId);
                setSpeechError("");
                saveSpeechDraft({ modelId });
              }}
              defaultProviderId={defaultProviderId}
              defaultProviderName={defaultProviderName}
              placeholder={models.some((model) => model.enabled && model.published && model.capabilities.includes("speech")) ? undefined : "尚未启用配音模型"}
              automaticHint="按默认服务商选择可用配音模型，无在线模型时使用本机语音"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
              disabled={generatingSpeech}
              className="canvas-audio-model-picker"
            />
            <small>上次生成：{speechServiceLabel}</small>
          </div>
        </div>
        <button
          type="button"
          className="canvas-audio-panel-upload"
          onClick={() => inputRef.current?.click()}
          disabled={generatingSpeech}
        >
          {hasAudio ? "替换音频" : "导入音频"}
        </button>
        <button
          type="button"
          className="canvas-node-editor-generate canvas-audio-generate"
          onClick={() => void generateSpeech()}
          disabled={!speechText.trim() || generatingSpeech}
          aria-busy={generatingSpeech}
        >
          {generatingSpeech ? "正在生成…" : speechError ? "重新生成配音" : hasAudio ? "生成并替换" : "生成配音"}
        </button>
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="audio/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onReplaceAudio(node.id, file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

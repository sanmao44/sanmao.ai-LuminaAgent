import { useEffect, useRef, useState } from "react";
import type { CanvasAudioDraft, CanvasAudioGenerationMeta, CanvasAudioMusicDraft, CanvasAudioMusicTask, CanvasAudioTranscriptionDraft, CanvasAudioTranscriptionMeta, CanvasNode } from "@/lib/canvas/types";
import type { ProviderConnection, RegistryModel } from "@/lib/types";
import { selectAutomaticModel } from "@/lib/model-selection";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { canvasAudioMusicModels, canvasAudioTranscriptionModels, buildCanvasMusicRequest, canvasMusicTaskSnapshot, canvasTranscriptionResult } from "@/lib/canvas/audio-tools";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import ModelPicker from "@/components/ModelPicker";
import SelectMenu from "@/components/SelectMenu";
import { SPEECH_VOICE_PREVIEW_TEXT, getSpeechModelProfile, type SpeechOutputFormat } from "@/packages/contracts/audio-synthesis";
import type { AudioTranscriptionResponseFormat } from "@/packages/contracts/audio-transcription";
import type { CangyuanMediaTask, CangyuanMusicOptions } from "@/packages/contracts/cangyuan-media";
import { speechVoiceOptions } from "@/components/audio/voice-options";
import { speechOutputFormatLabel } from "@/components/audio/speech-format-options";
import { buildCanvasSpeechRequest } from "@/components/canvas/audio-speech-request";
import CangyuanMusicOptionsFields from "@/components/cangyuan/CangyuanMusicOptionsFields";

const SPEECH_TEXT_LIMIT = 5000;
const TRANSCRIPTION_MAX_BYTES = 50 * 1024 * 1024;
const TRANSCRIPTION_ACCEPT = ".mp3,.wav,.ogg,.m4a,.flac,.webm,.pcm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/webm";
const TRANSCRIPTION_LANGUAGES = [
  { value: "", label: "自动识别" }, { value: "zh", label: "中文" }, { value: "en", label: "英语" },
  { value: "ja", label: "日语" }, { value: "ko", label: "韩语" }, { value: "fr", label: "法语" },
  { value: "de", label: "德语" }, { value: "es", label: "西班牙语" }, { value: "__custom", label: "其他语言" },
];
const TRANSCRIPTION_FORMATS = [
  { value: "verbose_json", label: "文字与分段时间" }, { value: "json", label: "标准文字" }, { value: "text", label: "纯文本" },
];

export type CanvasAudioNodePanelProps = {
  node: CanvasNode;
  onReplaceAudio: (nodeId: string, file: File, generation?: CanvasAudioGenerationMeta) => Promise<boolean>;
  onSpeechDraftChange: (nodeId: string, draft: CanvasAudioDraft) => void;
  onTranscriptionDraftChange: (nodeId: string, draft: CanvasAudioTranscriptionDraft) => void;
  onTranscriptionChange: (nodeId: string, result: CanvasAudioTranscriptionMeta) => void;
  onMusicDraftChange: (nodeId: string, draft: CanvasAudioMusicDraft) => void;
  onMusicTaskChange: (nodeId: string, task: CanvasAudioMusicTask) => void;
  onDurationChange: (nodeId: string, durationSeconds: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  models: RegistryModel[];
  providers: ProviderConnection[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  defaultModelId?: string | null;
  projectId?: string;
  canvasId?: string;
};

export default function CanvasAudioNodePanel({
  node,
  onReplaceAudio,
  onSpeechDraftChange,
  onTranscriptionDraftChange,
  onTranscriptionChange,
  onMusicDraftChange,
  onMusicTaskChange,
  onDurationChange,
  onNotify,
  models,
  defaultProviderId,
  defaultProviderName,
  defaultModelId,
  projectId,
  canvasId,
}: CanvasAudioNodePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptionInputRef = useRef<HTMLInputElement | null>(null);
  const [activeMode, setActiveMode] = useState<"speech" | "transcription" | "music">("speech");
  const [speechText, setSpeechText] = useState(() => node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
  const [voice, setVoice] = useState(() => node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
  const [customVoiceSelected, setCustomVoiceSelected] = useState(false);
  const [speechModelId, setSpeechModelId] = useState(() => node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
  const [speechFormat, setSpeechFormat] = useState<SpeechOutputFormat>(() => (node.data.speechDraft?.format || node.data.speechGeneration?.format || "mp3") as SpeechOutputFormat);
  const [speechSpeed, setSpeechSpeed] = useState(() => node.data.speechDraft?.speed ?? node.data.speechGeneration?.speed ?? 1);
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [transcriptionDraft, setTranscriptionDraft] = useState<CanvasAudioTranscriptionDraft>(() => node.data.transcriptionDraft || {});
  const [transcriptionFile, setTranscriptionFile] = useState<File | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const [musicDraft, setMusicDraft] = useState<CanvasAudioMusicDraft>(() => node.data.musicDraft || { prompt: "", options: {} });
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState("");
  const [uploadingMusicFields, setUploadingMusicFields] = useState<Set<string>>(() => new Set());
  const data = node.data;
  const hasAudio = Boolean(data.url);
  const musicModels = canvasAudioMusicModels(models, providers);
  const transcriptionModels = canvasAudioTranscriptionModels(models, providers);
  const speechModels = models.filter((model) => model.kind === "audio" && model.enabled && model.published && model.capabilities.includes("speech"));
  const selectedModel = speechModelId !== "auto"
    ? speechModels.find((model) => model.id === speechModelId)
    : selectAutomaticModel(speechModels, defaultProviderId, defaultModelId);
  const speechProfile = getSpeechModelProfile(selectedModel?.rawId || "");
  const knownVoice = Boolean(speechProfile?.suggestedVoices.includes(voice));
  const voiceChoice = knownVoice ? voice : customVoiceSelected || voice ? "custom" : "";
  const supportedFormat = speechProfile?.responseFormats.includes(speechFormat)
    ? speechFormat
    : speechProfile?.responseFormats[0];
  const speechSpeedValue = speechProfile?.speedRange
    ? Math.min(speechProfile.speedRange.max, Math.max(speechProfile.speedRange.min, speechSpeed))
    : speechSpeed;
  const speechServiceLabel = data.speechGeneration?.engine === "offline"
    ? "本机离线语音"
    : data.speechGeneration?.modelName || "尚未生成";
  const selectedMusicModel = musicModels.find((model) => model.id === musicDraft.modelId) || musicModels[0];
  const selectedTranscriptionModel = transcriptionModels.find((model) => model.id === transcriptionDraft.modelId) || transcriptionModels[0];
  const musicProfile = selectedMusicModel ? getSpeechModelProfile(selectedMusicModel.rawId) : null;
  const audioMusicProfile = selectedMusicModel ? importCangyuanMusicProfile(selectedMusicModel.rawId) : null;

  useEffect(() => {
    setSpeechText(node.data.speechDraft?.text ?? node.data.speechGeneration?.text ?? "");
    setVoice(node.data.speechDraft?.voice ?? node.data.speechGeneration?.voice ?? "");
    setSpeechModelId(node.data.speechDraft?.modelId ?? node.data.speechGeneration?.requestedModelId ?? "auto");
    setSpeechFormat((node.data.speechDraft?.format || node.data.speechGeneration?.format || "mp3") as SpeechOutputFormat);
    setSpeechSpeed(node.data.speechDraft?.speed ?? node.data.speechGeneration?.speed ?? 1);
    setSpeechError("");
  }, [node.id, node.data.speechDraft?.text, node.data.speechDraft?.voice, node.data.speechDraft?.modelId, node.data.speechDraft?.format, node.data.speechDraft?.speed, node.data.speechGeneration?.text, node.data.speechGeneration?.voice, node.data.speechGeneration?.requestedModelId, node.data.speechGeneration?.format, node.data.speechGeneration?.speed]);

  useEffect(() => {
    setTranscriptionDraft(node.data.transcriptionDraft || {});
    setTranscriptionFile(null);
    setTranscriptionError("");
    setMusicDraft(node.data.musicDraft || { prompt: "", options: {} });
    setMusicError("");
  }, [node.id, node.data.transcriptionDraft, node.data.musicDraft]);

  useEffect(() => setCustomVoiceSelected(false), [node.id]);

  useEffect(() => () => {
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (!voicePreviewUrl) return;
    setVoicePreviewUrl("");
  }, [speechModelId, voice, speechFormat, speechSpeed]);

  function saveSpeechDraft(next: Partial<CanvasAudioDraft> = {}) {
    onSpeechDraftChange(node.id, {
      text: next.text ?? speechText,
      voice: next.voice ?? voice,
      modelId: next.modelId ?? speechModelId,
      format: next.format ?? speechFormat,
      speed: next.speed ?? speechSpeed,
      updatedAt: Date.now(),
    });
  }

  function replaceVoicePreviewUrl(url: string) {
    setVoicePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
  }

  async function previewVoice() {
    if (!selectedModel || previewingVoice || generatingSpeech) return;
    setSpeechError("");
    setPreviewingVoice(true);
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCanvasSpeechRequest({
          text: SPEECH_VOICE_PREVIEW_TEXT,
          voice,
          modelId: speechModelId === "auto" ? selectedModel.id : speechModelId,
          ...(supportedFormat ? { format: supportedFormat } : {}),
          ...(speechProfile?.speedRange ? { speed: speechSpeedValue } : {}),
          preview: true,
          nodeId: node.id,
        })),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(String(body?.error || `音色试听失败（${response.status}）`));
      }
      const blob = await response.blob();
      if (blob.type.includes("pcm") || (response.headers.get("X-Audio-Extension") || "").toLowerCase() === "pcm") {
        throw new Error("PCM 是未压缩音频，当前浏览器无法直接试听；请选择 MP3、WAV 或 Opus。");
      }
      replaceVoicePreviewUrl(URL.createObjectURL(blob));
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "音色试听失败，请稍后重试。");
    } finally {
      setPreviewingVoice(false);
    }
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
        body: JSON.stringify(buildCanvasSpeechRequest({
          text,
          voice,
          modelId: speechModelId,
          ...(supportedFormat ? { format: supportedFormat } : {}),
          ...(speechProfile?.speedRange ? { speed: speechSpeedValue } : {}),
          projectId,
          canvasId,
          nodeId: node.id,
        })),
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
        ...(supportedFormat ? { format: supportedFormat } : {}),
        ...(speechProfile?.speedRange ? { speed: speechSpeedValue } : {}),
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
          {speechProfile ? <>
            <span className="canvas-audio-option-label">音色</span>
            <SelectMenu
              value={voiceChoice}
              ariaLabel="配音音色"
              className="canvas-audio-option-select"
              menuClassName="canvas-audio-option-menu"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              options={[
                { value: "", label: "使用模型默认音色" },
                ...speechVoiceOptions(speechProfile),
                { value: "custom", label: "自定义音色名称" },
              ]}
              onChange={(value) => {
                const nextVoice = value === "custom" ? "" : value;
                setCustomVoiceSelected(value === "custom");
                setVoice(nextVoice);
                setSpeechError("");
                saveSpeechDraft({ voice: nextVoice });
              }}
              disabled={generatingSpeech || previewingVoice}
            />
            {voiceChoice === "custom" && <input
              id={`canvas-audio-voice-${node.id}`}
              value={voice}
              maxLength={100}
              placeholder="输入服务商支持的音色名称"
              onChange={(event) => {
                const nextVoice = event.target.value;
                setVoice(nextVoice);
                setSpeechError("");
                saveSpeechDraft({ voice: nextVoice });
              }}
              disabled={generatingSpeech || previewingVoice}
            />}
            <span className="canvas-audio-option-label">输出格式</span>
            <SelectMenu
              value={supportedFormat || speechProfile.responseFormats[0]}
              ariaLabel="配音输出格式"
              className="canvas-audio-option-select"
              menuClassName="canvas-audio-option-menu"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              options={speechProfile.responseFormats.map((format) => ({ value: format, label: speechOutputFormatLabel(format) }))}
              onChange={(value) => {
                setSpeechFormat(value as SpeechOutputFormat);
                saveSpeechDraft({ format: value as SpeechOutputFormat });
              }}
              disabled={generatingSpeech || previewingVoice}
            />
            {speechProfile.speedRange && <div className="canvas-audio-option-speed">
              <label htmlFor={`canvas-audio-speed-${node.id}`}>语速</label>
              <input
                id={`canvas-audio-speed-${node.id}`}
                type="range"
                min={speechProfile.speedRange.min}
                max={speechProfile.speedRange.max}
                step="0.05"
                value={speechSpeedValue}
                onChange={(event) => {
                  const speed = Number(event.target.value);
                  setSpeechSpeed(speed);
                  saveSpeechDraft({ speed });
                }}
                disabled={generatingSpeech || previewingVoice}
              />
              <input
                type="number"
                aria-label="语速数值"
                min={speechProfile.speedRange.min}
                max={speechProfile.speedRange.max}
                step="0.05"
                value={speechSpeedValue}
                onChange={(event) => {
                  const speed = Number(event.target.value);
                  if (!Number.isFinite(speed)) return;
                  const bounded = Math.max(speechProfile.speedRange!.min, Math.min(speechProfile.speedRange!.max, speed));
                  setSpeechSpeed(bounded);
                  saveSpeechDraft({ speed: bounded });
                }}
                disabled={generatingSpeech || previewingVoice}
              />
            </div>}
          </> : <>
            <label htmlFor={`canvas-audio-voice-${node.id}`}>音色名称</label>
            <input
              id={`canvas-audio-voice-${node.id}`}
              value={voice}
              maxLength={100}
              placeholder="留空使用默认音色"
              onChange={(event) => {
                const nextVoice = event.target.value;
                setVoice(nextVoice);
                setSpeechError("");
                saveSpeechDraft({ voice: nextVoice });
              }}
              disabled={generatingSpeech || previewingVoice}
            />
          </>}
          <button type="button" className="canvas-audio-voice-preview" onClick={() => void previewVoice()} disabled={!selectedModel || generatingSpeech || previewingVoice || supportedFormat === "pcm"} title={supportedFormat === "pcm" ? "PCM 格式不支持浏览器试听" : "使用当前模型与音色生成试听片段"}>
            {previewingVoice ? "正在生成试听…" : "试听音色"}
          </button>
          <small>试听使用固定短句，会按当前模型正常计费，不保存到记录。{supportedFormat === "pcm" ? "切换格式后可播放试听。" : ""}</small>
          {voicePreviewUrl && supportedFormat !== "pcm" && <CanvasAudioPlayer src={voicePreviewUrl} name="音色试听" compact />}
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
                setCustomVoiceSelected(false);
                setSpeechError("");
                saveSpeechDraft({ modelId });
              }}
              defaultProviderId={defaultProviderId}
              defaultProviderName={defaultProviderName}
              placeholder={models.some((model) => model.enabled && model.published && model.capabilities.includes("speech")) ? undefined : "尚未启用配音模型"}
              automaticHint="按默认服务商选择可用配音模型，无在线模型时使用本机语音"
              portalZIndex={CANVAS_Z_INDEX.modalPopover}
              dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
              disabled={generatingSpeech || previewingVoice}
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

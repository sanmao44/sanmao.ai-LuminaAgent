import { useEffect, useRef, useState } from "react";
import type { CanvasAudioGenerationMeta, CanvasNode } from "@/lib/canvas/types";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";

const SPEECH_TEXT_LIMIT = 5000;

export type CanvasAudioNodePanelProps = {
  node: CanvasNode;
  onReplaceAudio: (nodeId: string, file: File, generation?: CanvasAudioGenerationMeta) => Promise<boolean>;
  onDurationChange: (nodeId: string, durationSeconds: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  projectId?: string;
  canvasId?: string;
};

export default function CanvasAudioNodePanel({
  node,
  onReplaceAudio,
  onDurationChange,
  onNotify,
  projectId,
  canvasId,
}: CanvasAudioNodePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [speechText, setSpeechText] = useState(() => node.data.speechGeneration?.text || node.data.speechDraft?.text || "");
  const [voice, setVoice] = useState(() => node.data.speechGeneration?.voice || node.data.speechDraft?.voice || "");
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const data = node.data;
  const hasAudio = Boolean(data.url);

  useEffect(() => {
    setSpeechText(node.data.speechGeneration?.text || node.data.speechDraft?.text || "");
    setVoice(node.data.speechGeneration?.voice || node.data.speechDraft?.voice || "");
  }, [node.id, node.data.speechDraft?.text, node.data.speechDraft?.voice, node.data.speechGeneration?.text, node.data.speechGeneration?.voice]);

  async function generateSpeech() {
    const text = speechText.trim();
    if (!text || generatingSpeech) return;
    setGeneratingSpeech(true);
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(voice.trim() ? { voice: voice.trim() } : {}),
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
      const generation: CanvasAudioGenerationMeta = {
        text,
        engine,
        ...(modelName ? { modelName } : {}),
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        createdAt: Date.now(),
      };
      await onReplaceAudio(node.id, file, generation);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "配音生成失败，请稍后重试。", "error");
    } finally {
      setGeneratingSpeech(false);
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
      <div className="canvas-audio-panel-intro">
        <div className="canvas-audio-panel-intro-copy">
          <span className="canvas-audio-panel-icon" aria-hidden="true">♫</span>
          <div>
            <b>{hasAudio ? "参考音频" : "导入参考音频"}</b>
            <small>独立素材 · 仅连接到视频节点</small>
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
          <small>导入现有素材，或输入旁白文本直接生成配音</small>
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
      <section className="canvas-audio-speech" aria-label="文本转配音">
        <label htmlFor={`canvas-audio-speech-${node.id}`}>配音文本</label>
        <textarea
          id={`canvas-audio-speech-${node.id}`}
          value={speechText}
          maxLength={SPEECH_TEXT_LIMIT}
          rows={4}
          placeholder="输入旁白、台词或解说词…"
          onChange={(event) => setSpeechText(event.target.value)}
          disabled={generatingSpeech}
        />
        <small className="canvas-audio-speech-hint">生成后保留文本，可微调文案或音色继续试听。</small>
        <div className="canvas-audio-speech-footer">
          <small>{speechText.length} / {SPEECH_TEXT_LIMIT}</small>
          <button
            type="button"
            className="canvas-audio-panel-upload canvas-audio-generate"
            onClick={() => void generateSpeech()}
            disabled={!speechText.trim() || generatingSpeech}
            aria-busy={generatingSpeech}
          >
            {generatingSpeech ? "正在生成…" : hasAudio ? "生成并替换音频" : "生成配音"}
          </button>
        </div>
        <details className="canvas-audio-advanced">
          <summary>音色设置（可选）</summary>
          <label htmlFor={`canvas-audio-voice-${node.id}`}>音色名称</label>
          <input
            id={`canvas-audio-voice-${node.id}`}
            value={voice}
            maxLength={100}
            placeholder="留空使用默认音色"
            onChange={(event) => setVoice(event.target.value)}
            disabled={generatingSpeech}
          />
        </details>
        <small className="canvas-audio-speech-hint">使用已配置的配音模型；本机语音引擎是否可用取决于运行环境。</small>
      </section>
      <div className="canvas-audio-panel-actions">
        <button type="button" className="canvas-audio-panel-upload" onClick={() => inputRef.current?.click()}>
          {hasAudio ? "替换音频" : "添加音频"}
        </button>
        <span>{hasAudio ? "替换成功后会保留节点、分组和视频连线" : "导入后即可拖动右侧端口连接视频"}</span>
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

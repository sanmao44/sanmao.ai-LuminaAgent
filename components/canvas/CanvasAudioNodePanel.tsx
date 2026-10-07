import { useRef } from "react";
import type { CanvasNode } from "@/lib/canvas/types";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";

export type CanvasAudioNodePanelProps = {
  node: CanvasNode;
  onReplaceAudio: (nodeId: string, file: File) => void;
  onDurationChange: (nodeId: string, durationSeconds: number) => void;
};

export default function CanvasAudioNodePanel({
  node,
  onReplaceAudio,
  onDurationChange,
}: CanvasAudioNodePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const data = node.data;
  const hasAudio = Boolean(data.url);
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
          <span>尚未添加文件</span>
          <small>支持 MP3、WAV、M4A、AAC、OGG、FLAC 等音频格式</small>
        </div>
      )}
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
          if (file) onReplaceAudio(node.id, file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

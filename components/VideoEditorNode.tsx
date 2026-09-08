import type { CanvasNode, CanvasVideoEditorState } from "@/lib/canvas/types";
import { normalizeVideoEditorState } from "@/lib/canvas/video-editor";

export type VideoEditorNodeProps = {
  node: CanvasNode;
  state?: CanvasVideoEditorState;
  inputs: CanvasNode[];
  onOpen: () => void;
};

function secondsLabel(value: number) {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function VideoEditorNode({ state: rawState, inputs, onOpen }: VideoEditorNodeProps) {
  const state = normalizeVideoEditorState(rawState);
  const videoClips = state.clips.filter((clip) => clip.track === "video").length;
  const audioClips = state.clips.filter((clip) => clip.track === "audio").length;
  const captionClips = state.clips.filter((clip) => clip.track === "caption").length;
  return (
    <div className="canvas-video-editor-card" data-canvas-wheel-isolate>
      <div className="canvas-video-editor-head">
        <div className="canvas-video-editor-title">
          <span className="canvas-video-editor-icon" aria-hidden="true">✂</span>
          <div>
            <b>视频编辑节点</b>
            <small>可持久化编辑计划</small>
          </div>
        </div>
        <button
          type="button"
          className="canvas-video-editor-open"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          打开编辑器
        </button>
      </div>
      <div className="canvas-video-editor-summary">
        <div><b>{secondsLabel(state.projectDuration)}</b><small>计划时长</small></div>
        <div><b>{videoClips}</b><small>视频轨</small></div>
        <div><b>{audioClips}</b><small>音频轨</small></div>
        <div><b>{captionClips}</b><small>字幕</small></div>
      </div>
      {inputs.length ? (
        <div className="canvas-video-editor-inputs" aria-label="已连接素材">
          {inputs.slice(0, 5).map((input) => (
            <span key={input.id} title={String(input.data.name || "素材")}>
              <i>{input.data.kind === "audio" ? "♫" : input.data.kind === "video" ? "▶" : "▣"}</i>
              {String(input.data.name || "素材")}
            </span>
          ))}
          {inputs.length > 5 && <small>+{inputs.length - 5}</small>}
        </div>
      ) : (
        <div className="canvas-video-editor-empty">连接图片、视频或音频节点后自动入轨</div>
      )}
      <div className="canvas-video-editor-foot">
        <span>V1 · A1 · 字幕轨</span>
        <span>{state.aspect} · {state.fps} fps</span>
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { CanvasDocument, CanvasInputRole, CanvasNode, CanvasRuntimeState } from "@/lib/canvas/types";
import { resolveCanvasVideoInputs } from "@/lib/canvas/references";
import { resolveAvailableCreationModel, type VideoCreationSettings } from "@/lib/creation/settings";
import { getVideoModelLimits } from "@/lib/video-model-limits";

export default function CanvasNodeReferenceStrip({
  target,
  document,
  runtime,
  references,
  contexts,
  onReorder,
  onRemove,
  onDrop,
  onAddFiles,
  onPickFromCanvas,
  onPreview,
  onTextPreview,
  onRestoreAutomatic,
  resolveInputRoles,
  resolveVideoCapabilities,
}: {
  target: CanvasNode;
  document: CanvasDocument;
  runtime: CanvasRuntimeState | null;
  references: CanvasNode[];
  contexts: CanvasNode[];
  onReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onRemove: (ownerId: string, sourceId: string) => void;
  onDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddFiles: (ownerId: string, files: File[]) => void;
  onPickFromCanvas?: (role?: CanvasInputRole) => void;
  onPreview: (node: CanvasNode) => void;
  onTextPreview: (node: CanvasNode) => void;
  onRestoreAutomatic?: (targetId: string) => void;
  resolveInputRoles: (document: CanvasDocument, targetId: string) => ReadonlyMap<string, CanvasInputRole | undefined>;
  resolveVideoCapabilities: (settings: VideoCreationSettings, runtime: CanvasRuntimeState | null) => { supportsAudio: boolean };
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const isVideoTarget = (target.type === "media" || target.type === "generator") && target.data.kind === "video";
  const videoParams = isVideoTarget && target.data.params && typeof target.data.params === "object" && "inputMode" in target.data.params
    ? target.data.params as VideoCreationSettings
    : undefined;
  const videoModel = videoParams ? resolveAvailableCreationModel(videoParams, runtime).model : null;
  const videoProvider = runtime?.providers.find((item) => item.id === videoModel?.providerId);
  const videoLimits = videoParams ? getVideoModelLimits(videoModel || undefined, videoProvider) : undefined;
  const videoInputs = videoParams
    ? resolveCanvasVideoInputs(
        references,
        videoParams.inputMode,
        resolveInputRoles(document, target.id),
          { maxReferenceImages: videoLimits?.maxReferenceImages, maxReferenceVideos: videoLimits?.maxReferenceVideos, maxAudios: videoLimits?.maxAudios, supportsAudio: videoModel ? resolveVideoCapabilities(videoParams, runtime).supportsAudio : undefined },
      )
    : undefined;
  const connectedImageCount = references.filter((item) => item.data.kind === "image").length;
  const modeLabel = videoParams?.inputMode === "reference"
    ? connectedImageCount >= 3 ? "多张参考图生视频" : "参考图生视频"
    : videoParams?.inputMode === "first-frame"
      ? "首帧图生视频"
      : videoParams?.inputMode === "frames"
        ? "首尾帧图生视频"
        : "文生视频";

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId?: string, role?: CanvasInputRole) => {
    event.preventDefault();
    event.stopPropagation();
    const fromIndex = Number(event.dataTransfer.getData("application/x-sanmao-reference-index"));
    if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < references.length && targetId) {
      if (role && role !== "reference-image") onDrop(target.id, references[fromIndex].id, role);
      else onReorder(target.id, references[fromIndex].id, targetId);
      setDraggedId(null);
      return;
    }
    const sourceId = event.dataTransfer.getData("application/x-sanmao-canvas-node");
    if (sourceId) onDrop(target.id, sourceId, role || "reference-image");
    setDraggedId(null);
  };

  const renderItem = (reference: CanvasNode, index: number, extraClass = "", role?: CanvasInputRole) => (
    <div
      key={`${reference.id}-${role || "reference"}`}
      className={`canvas-editor-reference-item${draggedId === reference.id ? " dragging" : ""}${extraClass ? ` ${extraClass}` : ""}`}
      draggable
      onDragStart={(event) => {
        setDraggedId(reference.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-sanmao-canvas-node", reference.id);
        event.dataTransfer.setData("application/x-sanmao-reference-index", String(references.findIndex((item) => item.id === reference.id)));
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => handleDrop(event, reference.id)}
      onDragEnd={() => setDraggedId(null)}
    >
      <button type="button" className="canvas-editor-reference-preview" onClick={() => onPreview(reference)} title={reference.data.name || `引用 ${index + 1}`}>
        <span>{index + 1}</span>
        {reference.data.kind === "video" ? <video src={reference.data.url} muted playsInline /> : reference.data.kind === "audio" ? (
          <span className="canvas-editor-reference-audio-preview" aria-label="音频参考">
            <span aria-hidden="true">♫</span>
            <i aria-hidden="true"><b /><b /><b /><b /><b /><b /><b /></i>
          </span>
        ) : <img src={reference.data.url} alt={reference.data.name || `引用 ${index + 1}`} />}
      </button>
      {role && (
        <b className="canvas-editor-reference-name">{reference.data.name || (reference.data.kind === "video" ? "视频素材" : reference.data.kind === "audio" ? "音频素材" : "图片素材")}</b>
      )}
      <button type="button" className="canvas-editor-reference-remove" aria-label={`移除引用 ${index + 1}`} onClick={() => onRemove(target.id, reference.id)}>×</button>
    </div>
  );

  const renderSlot = (label: string, slotRole: "first-frame" | "last-frame", reference: CanvasNode | undefined) => (
    <div
      className={`canvas-editor-frame-slot${reference ? " filled" : " empty"}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => handleDrop(event, reference?.id || "__slot__", slotRole)}
    >
      <span className="canvas-editor-slot-label"><b>{label}</b><small>{reference ? "已连接" : "拖入图片"}</small></span>
      {reference ? renderItem(reference, references.findIndex((item) => item.id === reference.id), "slot-item", slotRole) : (
        <button type="button" className="canvas-editor-frame-slot-empty" onClick={() => onPickFromCanvas?.(slotRole)}>
          ＋ 从画布选择
        </button>
      )}
    </div>
  );

  const unusedImages = videoInputs?.unused.filter((item) => item.data.kind === "image") || [];
  const unusedAudios = videoInputs?.unused.filter((item) => item.data.kind === "audio") || [];
  const connectedVideos = references.filter((item) => item.data.kind === "video");
  const connectedAudios = references.filter((item) => item.data.kind === "audio");
  const connectedVideo = videoInputs?.referenceVideo || connectedVideos[0];
  const imageWarning = isVideoTarget && videoParams?.inputMode === "text" && references.some((item) => item.data.kind === "image");
  const videoWarning = isVideoTarget && connectedVideos.length > 0 && (
    videoParams?.inputMode === "text" || videoLimits?.maxReferenceVideos === 0
  );
  const audioWarning = isVideoTarget && connectedAudios.length > 0 && (
    videoParams?.inputMode === "text" || videoLimits?.maxAudios === 0 || unusedAudios.length > 0
  );

  return (
    <div className="canvas-editor-references" onDragOver={(event) => event.preventDefault()}>
      <div className="canvas-editor-section-head">
        <span><b>输入与引用</b><small>{isVideoTarget ? `${target.data.videoInputModeAuto === false ? "手动锁定" : "自动匹配"} · ${modeLabel}` : "拖动缩略图可调整顺序"}</small></span>
        <div>
           <b>{videoLimits ? `图片 ${connectedImageCount}/${videoLimits.maxReferenceImages}` : `${references.length}/16`}</b>
           {isVideoTarget && connectedVideos.length > 0 && <small>视频输入 {connectedVideos.length}/{videoLimits?.maxReferenceVideos ?? 10}</small>}
           {isVideoTarget && references.some((item) => item.data.kind === "audio") && <small>音频输入 {references.filter((item) => item.data.kind === "audio").length}/{videoLimits?.maxAudios ?? 10}</small>}
          {isVideoTarget && target.data.videoInputModeAuto === false && onRestoreAutomatic && <button type="button" onClick={() => onRestoreAutomatic(target.id)}>恢复自动</button>}
          {onPickFromCanvas && <button type="button" onClick={() => onPickFromCanvas()}>⌁ 画布点选</button>}
          <button type="button" onClick={() => inputRef.current?.click()}>＋ 添加</button>
        </div>
      </div>
      {imageWarning && <div className="canvas-editor-video-warning">已连接图片不会参与本次生成；当前为文生视频模式。</div>}
      {isVideoTarget && videoInputs && unusedImages.length > 0 && <div className="canvas-editor-video-warning">当前模式或模型上限无法提交全部 {connectedImageCount} 张图片，仍保留连接；请切换模型或生成方式。</div>}
      {videoWarning && (
        <div className="canvas-editor-video-warning">
          {videoLimits?.maxReferenceVideos === 0
            ? "当前视频模型不支持参考视频；请切换模型或移除视频输入。"
            : "已连接参考视频，但当前为文生视频模式；请切换到参考图/编辑模式后再生成。"}
        </div>
      )}
      {audioWarning && <div className="canvas-editor-video-warning">已连接参考音频，但当前模式或模型不会提交音频；请切换到参考模式或支持音频输入的模型。</div>}
      {contexts.length > 0 && (
        <div className="canvas-editor-context-slot">
          <span className="canvas-editor-slot-label">文本上下文 <small>来自 @ 引用</small></span>
          <div className="canvas-editor-context-items">
            {contexts.map((context, index) => (
              <button type="button" className="canvas-editor-context-item" key={context.id} onClick={() => onTextPreview(context)} title="点击查看完整文本引用">
                <span>{index + 1}</span>
                <b>{context.type === "prompt" ? "▤ Agent 文本" : context.data.kind === "video" ? "▶ 视频生成器" : "▣ 图片生成器"}</b>
                <small>{String(context.data.text || context.data.prompt || "上下文")}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {isVideoTarget && videoParams?.inputMode !== "reference" && videoParams?.inputMode !== "text" ? (
        <div className="canvas-editor-frame-slots">
          {renderSlot("首帧", "first-frame", videoInputs?.firstFrame)}
          {videoParams?.inputMode === "frames" && renderSlot("尾帧", "last-frame", videoInputs?.lastFrame)}
        </div>
      ) : (
        <div className="canvas-editor-reference-slot" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event)}>
           <span className="canvas-editor-slot-label">{target.type === "prompt" ? "上下文与参考" : "参考素材"} <small>按编号提交</small></span>
          <div className="canvas-editor-reference-items">
            {(isVideoTarget ? videoInputs?.referenceImages || [] : references).map((reference, index) => renderItem(reference, index))}
            {!references.length && <small className="canvas-editor-reference-empty">拖入节点，或点击添加本地素材</small>}
          </div>
        </div>
      )}
      {isVideoTarget && connectedVideos.length > 0 && <div className="canvas-editor-video-input">视频输入：{connectedVideos.map((video, index) => `${index + 1}. ${video.data.name || "已连接参考视频"}`).join(" · ")}</div>}
      {isVideoTarget && references.some((item) => item.data.kind === "audio") && <div className="canvas-editor-video-input">音频输入：{references.filter((item) => item.data.kind === "audio").map((audio, index) => `${index + 1}. ${audio.data.name || "已连接参考音频"}`).join(" · ")}</div>}
      {isVideoTarget && unusedImages.length > 0 && (
        <div className="canvas-editor-unused-inputs">
          <span className="canvas-editor-slot-label">本次未使用 <small>切换生成方式或移除连线后可重新使用</small></span>
          <div className="canvas-editor-reference-items">{unusedImages.map((reference, index) => renderItem(reference, references.findIndex((item) => item.id === reference.id), "unused-item"))}</div>
        </div>
      )}
      {isVideoTarget && unusedAudios.length > 0 && (
        <div className="canvas-editor-unused-inputs">
          <span className="canvas-editor-slot-label">未使用音频 <small>切换到参考模式或支持音频的模型后可提交</small></span>
          <div className="canvas-editor-reference-items">{unusedAudios.map((reference) => renderItem(reference, references.findIndex((item) => item.id === reference.id), "unused-item"))}</div>
        </div>
      )}
      <input ref={inputRef} hidden type="file" multiple accept={target.data.kind === "image" ? "image/png,image/jpeg,image/webp,.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.sql,.xml,.svg,.yaml,.yml,.sh,.ps1" : "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/*,.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.sql,.xml,.svg,.yaml,.yml,.sh,.ps1"} onChange={(event) => { if (event.target.files) onAddFiles(target.id, [...event.target.files]); event.currentTarget.value = ""; }} />
    </div>
  );
}

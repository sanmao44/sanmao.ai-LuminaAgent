"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  CanvasDocument,
  CanvasNode,
  CanvasVideoEditorClip,
  CanvasVideoEditorState,
  CanvasVideoEditorTrack,
} from "@/lib/canvas/types";
import {
  addVideoEditorCaption,
  clipEnd,
  clipsAtTime,
  normalizeVideoEditorState,
  reorderVideoEditorClips,
  removeVideoEditorClip,
  splitVideoEditorClip,
  toggleVideoEditorTrackMute,
  updateVideoEditorClip,
} from "@/lib/canvas/video-editor";

type VideoEditorWorkbenchProps = {
  node: CanvasNode;
  document: CanvasDocument;
  onClose: () => void;
  onChange: (state: CanvasVideoEditorState) => void;
};

const TRACKS: Array<{ id: CanvasVideoEditorTrack; label: string; icon: string }> = [
  { id: "video", label: "视频 · V1", icon: "▶" },
  { id: "audio", label: "音频 · A1", icon: "♫" },
  { id: "caption", label: "字幕", icon: "T" },
];

function secondsLabel(value: number) {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function sourceNodeForClip(document: CanvasDocument, clip: CanvasVideoEditorClip) {
  return clip.sourceNodeId ? document.nodes.find((item) => item.id === clip.sourceNodeId) : undefined;
}

function clipLabel(clip: CanvasVideoEditorClip) {
  return clip.text?.trim() || clip.name || (clip.type === "caption" ? "字幕" : "素材");
}

export default function VideoEditorWorkbench({ node, document, onClose, onChange }: VideoEditorWorkbenchProps) {
  const state = normalizeVideoEditorState(node.data.videoEditor);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(state.clips[0]?.id || null);
  const [playing, setPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(72);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const duration = Math.max(1, state.projectDuration);
  const selectedClip = state.clips.find((clip) => clip.id === selectedClipId) || null;
  const activeClips = clipsAtTime(state, currentTime);
  const activeVideo = activeClips.find((clip) => clip.track === "video");
  const activeAudio = activeClips.find((clip) => clip.track === "audio");
  const activeCaption = activeClips.find((clip) => clip.track === "caption");
  const previewNode = activeVideo ? sourceNodeForClip(document, activeVideo) : undefined;
  const audioNode = activeAudio ? sourceNodeForClip(document, activeAudio) : undefined;

  useEffect(() => {
    if (!state.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(state.clips[0]?.id || null);
    }
    setCurrentTime((value) => Math.min(value, state.projectDuration));
  }, [selectedClipId, state.clips, state.projectDuration]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => {
        const next = value + 0.08;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [duration, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && activeVideo) {
      const nextTime = Math.max(0, currentTime - activeVideo.start + activeVideo.sourceOffset);
      if (Math.abs(video.currentTime - nextTime) > 0.12) video.currentTime = nextTime;
      if (playing) {
        void video.play().catch(() => setPlaying(false));
      } else {
        video.pause();
      }
    }
    const audio = audioRef.current;
    if (audio && activeAudio) {
      const nextTime = Math.max(0, currentTime - activeAudio.start + activeAudio.sourceOffset);
      if (Math.abs(audio.currentTime - nextTime) > 0.12) audio.currentTime = nextTime;
      if (playing && !state.mutedTracks.includes("audio")) {
        void audio.play().catch(() => setPlaying(false));
      } else {
        audio.pause();
      }
    }
  }, [activeAudio, activeVideo, currentTime, playing, state.mutedTracks]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  const emit = (next: CanvasVideoEditorState) => onChange(normalizeVideoEditorState(next));
  const selectedTrackClips = useMemo(
    () => selectedClip ? state.clips.filter((clip) => clip.track === selectedClip.track).sort((a, b) => a.start - b.start) : [],
    [selectedClip, state.clips],
  );

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scrollLeft = timelineRef.current?.scrollLeft || 0;
    const time = ((event.clientX - rect.left + scrollLeft) / timelineZoom);
    setCurrentTime(Math.max(0, Math.min(duration, time)));
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!selectedClip) return;
    const index = selectedTrackClips.findIndex((clip) => clip.id === selectedClip.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selectedTrackClips.length) return;
    const ids = selectedTrackClips.map((clip) => clip.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    emit(reorderVideoEditorClips(state, selectedClip.track, ids));
  };

  const setClipPatch = (patch: Partial<CanvasVideoEditorClip>) => {
    if (!selectedClip) return;
    emit(updateVideoEditorClip(state, selectedClip.id, patch));
  };

  const previewStyle: CSSProperties = {
    transform: `translate(${(activeVideo?.x || 0) * 18}px, ${(activeVideo?.y || 0) * 18}px) scale(${activeVideo?.scale || 1})`,
    opacity: activeVideo?.opacity ?? 1,
  };

  return (
    <div
      className="canvas-modal-backdrop canvas-video-editor-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="canvas-workbench canvas-video-editor-workbench"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-video-editor-title"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="canvas-workbench-head">
          <div className="canvas-workbench-title">
            <span className="canvas-video-editor-icon" aria-hidden="true">✂</span>
            <div>
              <b id="canvas-video-editor-title">视频编辑工作台</b>
              <small>{String(node.data.name || "编辑计划")} · 不产生视频文件</small>
            </div>
          </div>
          <div className="canvas-workbench-head-actions">
            <span className="canvas-video-editor-plan-badge">编辑计划</span>
            <button type="button" onClick={onClose} aria-label="关闭视频编辑工作台" title="关闭">×</button>
          </div>
        </header>

        <div className="canvas-video-editor-body">
          <div className="canvas-video-editor-preview-column">
            <div className="canvas-video-editor-preview" aria-label="视频编辑预览">
              {previewNode?.data.url && previewNode.data.kind === "video" ? (
                <video ref={videoRef} src={String(previewNode.data.url)} muted playsInline preload="metadata" style={previewStyle} />
              ) : previewNode?.data.url && previewNode.data.kind === "image" ? (
                <img src={String(previewNode.data.url)} alt={String(previewNode.data.name || "视频画面")} style={previewStyle} />
              ) : (
                <div className="canvas-video-editor-preview-empty"><span>✂</span><b>等待素材画面</b><small>连接图片或视频节点后可预览</small></div>
              )}
              {activeCaption?.text && <div className="canvas-video-editor-caption-preview">{activeCaption.text}</div>}
              <span className="canvas-video-editor-timecode">{secondsLabel(currentTime)} / {secondsLabel(duration)}</span>
            </div>
            {audioNode?.data.url && (
              <audio
                ref={audioRef}
                className="canvas-video-editor-audio-preview"
                src={String(audioNode.data.url)}
                controls
                muted={state.mutedTracks.includes("audio")}
                preload="metadata"
                aria-label="音频轨预览"
              />
            )}
            <div className="canvas-video-editor-playbar">
              <button type="button" onClick={() => setCurrentTime(0)} title="回到开头" aria-label="回到开头">|&lt;</button>
              <button type="button" className="primary" onClick={() => setPlaying((value) => !value)} title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"}>{playing ? "Ⅱ" : "▶"}</button>
              <button type="button" onClick={() => setCurrentTime(duration)} title="跳到结尾" aria-label="跳到结尾">&gt;|</button>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.01"
                value={Math.min(currentTime, duration)}
                onChange={(event) => {
                  setPlaying(false);
                  setCurrentTime(Number(event.target.value));
                }}
                aria-label="播放头位置"
              />
              <output>{secondsLabel(currentTime)}</output>
            </div>
          </div>

          <aside className="canvas-video-editor-inspector">
            <div className="canvas-video-editor-inspector-head"><b>检查器</b><small>{selectedClip ? clipLabel(selectedClip) : "未选择片段"}</small></div>
            {selectedClip ? (
              <div className="canvas-video-editor-fields">
                <label><span>名称</span><input value={selectedClip.name} onChange={(event) => setClipPatch({ name: event.target.value })} /></label>
                {selectedClip.track === "caption" && <label><span>字幕</span><textarea value={selectedClip.text || ""} onChange={(event) => setClipPatch({ text: event.target.value })} /></label>}
                <div className="canvas-video-editor-field-grid">
                  <label><span>开始</span><input type="number" min="0" step="0.1" value={selectedClip.start} onChange={(event) => setClipPatch({ start: Math.max(0, Number(event.target.value)) })} /></label>
                  <label><span>时长</span><input type="number" min="0.05" step="0.1" value={selectedClip.duration} onChange={(event) => setClipPatch({ duration: Math.max(0.05, Number(event.target.value)) })} /></label>
                  <label><span>源偏移</span><input type="number" min="0" step="0.1" value={selectedClip.sourceOffset} onChange={(event) => setClipPatch({ sourceOffset: Math.max(0, Number(event.target.value)) })} /></label>
                  {selectedClip.track === "video" && <label><span>透明度</span><input type="number" min="0" max="1" step="0.05" value={selectedClip.opacity ?? 1} onChange={(event) => setClipPatch({ opacity: Number(event.target.value) })} /></label>}
                  {selectedClip.track === "audio" && <label><span>音量</span><input type="number" min="0" max="2" step="0.05" value={selectedClip.volume ?? 1} onChange={(event) => setClipPatch({ volume: Number(event.target.value) })} /></label>}
                </div>
                <div className="canvas-video-editor-inspector-actions">
                  <button type="button" onClick={() => moveSelected(-1)} title="向前移动">← 向前</button>
                  <button type="button" onClick={() => moveSelected(1)} title="向后移动">向后 →</button>
                  <button type="button" onClick={() => emit(splitVideoEditorClip(state, selectedClip.id, currentTime))} disabled={currentTime <= selectedClip.start || currentTime >= clipEnd(selectedClip)} title="在播放头处分割">✂ 分割</button>
                  <button type="button" className="danger" onClick={() => { emit(removeVideoEditorClip(state, selectedClip.id)); setSelectedClipId(null); }} title="删除片段">删除</button>
                </div>
              </div>
            ) : (
              <div className="canvas-video-editor-inspector-empty">从时间线选择一个片段</div>
            )}
            <div className="canvas-video-editor-inspector-footer">
              <button type="button" onClick={() => { const next = addVideoEditorCaption(state, "新字幕", currentTime, 3); emit(next); setSelectedClipId(next.clips.at(-1)?.id || null); }}>＋ 添加字幕</button>
              <span>{state.clips.length} 个片段</span>
            </div>
          </aside>
        </div>

        <div className="canvas-video-editor-timeline-shell">
          <div className="canvas-video-editor-timeline-toolbar">
            <div><b>时间线</b><small>{state.aspect} · {state.fps} fps · {secondsLabel(state.projectDuration)}</small></div>
            <div className="canvas-video-editor-zoom"><button type="button" onClick={() => setTimelineZoom((value) => Math.max(36, value - 12))} aria-label="缩小时间线" title="缩小时间线">−</button><span>{Math.round(timelineZoom)} px/s</span><button type="button" onClick={() => setTimelineZoom((value) => Math.min(180, value + 12))} aria-label="放大时间线" title="放大时间线">＋</button></div>
          </div>
          <div className="canvas-video-editor-timeline" ref={timelineRef} data-canvas-wheel-isolate>
            <div className="canvas-video-editor-timeline-ruler" style={{ width: Math.max(560, duration * timelineZoom) }} onPointerDown={seekFromPointer}>
              {Array.from({ length: Math.floor(duration) + 1 }, (_, index) => <span key={index} style={{ left: index * timelineZoom }}>{secondsLabel(index)}</span>)}
              <i className="canvas-video-editor-playhead" style={{ left: currentTime * timelineZoom }} />
            </div>
            {TRACKS.map((track) => {
              const trackClips = state.clips.filter((clip) => clip.track === track.id);
              const muted = state.mutedTracks.includes(track.id);
              return (
                <div className={`canvas-video-editor-track-row track-${track.id}`} key={track.id}>
                  <div className="canvas-video-editor-track-label"><span>{track.icon}</span><b>{track.label}</b><button type="button" onClick={() => emit(toggleVideoEditorTrackMute(state, track.id))} aria-label={muted ? `取消静音${track.label}` : `静音${track.label}`} title={muted ? "取消静音" : "静音"}>{muted ? "静" : "音"}</button></div>
                  <div className="canvas-video-editor-track-lane" style={{ width: Math.max(560, duration * timelineZoom) }} onPointerDown={seekFromPointer}>
                    {trackClips.map((clip) => {
                      const source = sourceNodeForClip(document, clip);
                      return <button type="button" key={clip.id} className={`canvas-video-editor-clip clip-${clip.type}${clip.id === selectedClipId ? " selected" : ""}`} style={{ left: clip.start * timelineZoom, width: Math.max(30, clip.duration * timelineZoom) }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); setCurrentTime(clip.start); }} title={`${clipLabel(clip)} · ${secondsLabel(clip.duration)}`}><span>{source?.data.kind === "audio" ? "♫" : clip.type === "caption" ? "T" : clip.type === "video" ? "▶" : "▣"}</span><b>{clipLabel(clip)}</b><small>{secondsLabel(clip.duration)}</small></button>;
                    })}
                    <i className="canvas-video-editor-playhead" style={{ left: currentTime * timelineZoom }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

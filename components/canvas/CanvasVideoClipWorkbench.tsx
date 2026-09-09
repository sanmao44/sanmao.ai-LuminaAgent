"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CanvasNode, CanvasVideoClipState } from "@/lib/canvas/types";
import {
  normalizeCanvasVideoClipState,
  VIDEO_CLIP_MIN_DURATION,
  videoClipDurationSeconds,
} from "@/lib/canvas/video-clip";

type Props = {
  node: CanvasNode;
  onClose: () => void;
  onCreate: (clip: CanvasVideoClipState) => void | Promise<void>;
};

type TrimHandle = "start" | "end";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sourceDurationFor(node: CanvasNode) {
  const milliseconds = Number(node.data.sourceDurationMs || node.data.durationMs);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : 0;
}

function formatTime(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${tenths ? `.${tenths}` : ""}`;
}

function initialClip(node: CanvasNode, sourceDuration: number) {
  return normalizeCanvasVideoClipState(node.data.videoClip, sourceDuration) || {
    version: 1 as const,
    startTime: 0,
    endTime: sourceDuration,
    volume: 1,
    muted: false,
    playbackRate: 1 as const,
    fit: "contain" as const,
  };
}

export default function CanvasVideoClipWorkbench({ node, onClose, onCreate }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelinePointerRef = useRef<number | null>(null);
  const initialSourceDuration = sourceDurationFor(node);
  const [sourceDuration, setSourceDuration] = useState(initialSourceDuration);
  const [clip, setClip] = useState(() => initialClip(node, initialSourceDuration));
  const [currentTime, setCurrentTime] = useState(() => initialClip(node, initialSourceDuration).startTime);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const nextDuration = sourceDurationFor(node);
    const nextClip = initialClip(node, nextDuration);
    setSourceDuration(nextDuration);
    setClip(nextClip);
    setCurrentTime(nextClip.startTime);
    setPlaying(false);
    setScrubbing(false);
    setCreating(false);
    timelinePointerRef.current = null;
  }, [node.data.durationMs, node.data.sourceDurationMs, node.data.url, node.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.matches("input, textarea, select, button, [role=\"button\"], [contenteditable=\"true\"]") || target?.isContentEditable);
      if (event.code !== "Space" || typing) return;
      event.preventDefault();
      event.stopPropagation();
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        if (video.currentTime >= clip.endTime - 0.01) video.currentTime = clip.startTime;
        void video.play().catch(() => setPlaying(false));
      } else {
        video.pause();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [clip.endTime, clip.startTime, onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = clip.playbackRate;
    video.volume = clip.muted ? 0 : clip.volume;
  }, [clip.muted, clip.playbackRate, clip.volume]);

  const timelineDuration = Math.max(sourceDuration, clip.endTime, 1);
  const clipDuration = videoClipDurationSeconds(clip);
  const canCreate = clip.endTime - clip.startTime >= VIDEO_CLIP_MIN_DURATION;
  const fitLabel = clip.fit === "contain" ? "完整显示" : "填满裁切";
  const seek = (value: number) => {
    const next = clamp(value, clip.startTime, clip.endTime);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = next;
    }
    setPlaying(false);
    setCurrentTime(next);
  };

  const timelineValueFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return ratio * timelineDuration;
  };

  const beginTimelineScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelinePointerRef.current = event.pointerId;
    setScrubbing(true);
    seek(timelineValueFromPointer(event));
  };

  const scrubTimeline = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelinePointerRef.current !== event.pointerId) return;
    seek(timelineValueFromPointer(event));
  };

  const endTimelineScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelinePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    timelinePointerRef.current = null;
    setScrubbing(false);
  };

  const trimValueFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return ratio * timelineDuration;
  };

  const updateStart = (value: number) => {
    const max = Math.max(0, clip.endTime - VIDEO_CLIP_MIN_DURATION);
    const startTime = clamp(value, 0, max);
    setClip((current) => ({ ...current, startTime }));
    if (currentTime < startTime) seek(startTime);
  };

  const updateEnd = (value: number) => {
    const min = clip.startTime + VIDEO_CLIP_MIN_DURATION;
    const endTime = clamp(value, min, Math.max(min, sourceDuration || value));
    setClip((current) => ({ ...current, endTime }));
    if (currentTime > endTime) seek(endTime);
  };

  const updateTrimHandle = (handle: TrimHandle, event: ReactPointerEvent<HTMLElement>) => {
    const value = trimValueFromPointer(event);
    if (handle === "start") updateStart(value);
    else updateEnd(value);
  };

  const stepTrimHandle = (handle: TrimHandle, event: ReactKeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Home") {
      if (handle === "start") updateStart(0);
      return;
    }
    if (event.key === "End") {
      if (handle === "end") updateEnd(timelineDuration);
      return;
    }
    const step = event.shiftKey ? 1 : 0.1;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    if (handle === "start") updateStart(clip.startTime + direction * step);
    else updateEnd(clip.endTime + direction * step);
  };

  const renderTrimHandle = (handle: TrimHandle) => {
    const value = handle === "start" ? clip.startTime : clip.endTime;
    return (
      <span
        className={`canvas-video-clip-trim-handle ${handle}`}
        role="slider"
        tabIndex={0}
        aria-label={handle === "start" ? "剪辑开始时间" : "剪辑结束时间"}
        aria-valuemin={0}
        aria-valuemax={timelineDuration}
        aria-valuenow={value}
        style={{ left: `${(value / timelineDuration) * 100}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateTrimHandle(handle, event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => stepTrimHandle(handle, event)}
      />
    );
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= clip.endTime - 0.01) {
        video.currentTime = clip.startTime;
        setCurrentTime(clip.startTime);
      }
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  };

  const createClip = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await onCreate(clip);
    } finally {
      setCreating(false);
    }
  };

  const timelineStart = `${(clip.startTime / timelineDuration) * 100}%`;
  const timelineWidth = `${((clip.endTime - clip.startTime) / timelineDuration) * 100}%`;
  const playhead = `${(currentTime / timelineDuration) * 100}%`;

  return (
    <div className="canvas-modal-backdrop canvas-video-clip-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="canvas-video-clip-workbench"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-video-clip-title"
        data-canvas-wheel-isolate
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="canvas-video-clip-head">
          <div className="canvas-video-clip-title-block">
            <span className="canvas-video-clip-title-icon" aria-hidden="true">✂</span>
            <div>
              <b id="canvas-video-clip-title">视频剪辑</b>
              <small>从原视频取段，原始节点保持不变</small>
            </div>
          </div>
          <div className="canvas-video-clip-header-actions">
            <span className="canvas-video-clip-badge">无损引用</span>
            <button type="button" className="canvas-video-clip-close" onClick={onClose} aria-label="关闭视频剪辑" title="关闭">×</button>
          </div>
        </header>

        <div className="canvas-video-clip-preview">
          <div className="canvas-video-clip-preview-meta" aria-hidden="true">
            <span>原视频预览</span>
            <span>{formatTime(sourceDuration || timelineDuration)}</span>
          </div>
          <video
            ref={videoRef}
            className={`canvas-video-clip-media fit-${clip.fit}`}
            src={String(node.data.url || "")}
            muted={clip.muted}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (!Number.isFinite(duration) || duration <= 0) return;
              const restored = normalizeCanvasVideoClipState(node.data.videoClip, duration);
              const nextClip = restored || {
                ...clip,
                startTime: clamp(clip.startTime, 0, Math.max(0, duration - VIDEO_CLIP_MIN_DURATION)),
                endTime: clamp(clip.endTime || duration, VIDEO_CLIP_MIN_DURATION, duration),
              };
              setSourceDuration(duration);
              setClip(nextClip);
              event.currentTarget.currentTime = nextClip.startTime;
              setCurrentTime(nextClip.startTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              if (time >= clip.endTime - 0.01) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = clip.endTime;
                setCurrentTime(clip.endTime);
                return;
              }
              setCurrentTime(time);
            }}
            onEnded={() => setPlaying(false)}
          />
          <span className="canvas-video-clip-timecode"><b>{formatTime(currentTime)}</b><i>/</i>{formatTime(timelineDuration)}</span>
        </div>

        <div className="canvas-video-clip-playbar">
          <div className="canvas-video-clip-playback-current">
            <button type="button" className="canvas-video-clip-play" onClick={togglePlayback} aria-label={playing ? "暂停" : "播放"} title={playing ? "暂停" : "播放"}>{playing ? "Ⅱ" : "▶"}</button>
            <div><output>{formatTime(currentTime)} <i>/</i> {formatTime(timelineDuration)}</output><small>当前播放位置</small></div>
          </div>
          <div className="canvas-video-clip-playback-summary">
            <span>剪辑时长</span>
            <strong>{formatTime(clipDuration)}</strong>
            <small>空格播放 / 暂停</small>
          </div>
        </div>

        <section className="canvas-video-clip-timeline-section" aria-label="剪辑范围">
          <div className="canvas-video-clip-timeline-label"><div><span>剪辑范围</span><b>时间轴</b></div><small>按住轨道实时拖动播放头，拖动两端裁剪范围</small></div>
          <div
            className={`canvas-video-clip-timeline${scrubbing ? " is-scrubbing" : ""}`}
            onPointerDown={beginTimelineScrub}
            onPointerMove={scrubTimeline}
            onPointerUp={endTimelineScrub}
            onPointerCancel={endTimelineScrub}
            onLostPointerCapture={endTimelineScrub}
            aria-label="视频剪辑时间轴"
          >
            <span className="canvas-video-clip-selected-range" style={{ left: timelineStart, width: timelineWidth }} />
            <i className="canvas-video-clip-playhead" style={{ left: playhead }} />
            {renderTrimHandle("start")}
            {renderTrimHandle("end")}
          </div>
          <div className="canvas-video-clip-range-readout"><span><small>开始</small><output>{formatTime(clip.startTime)}</output></span><span><small>结束</small><output>{formatTime(clip.endTime)}</output></span></div>
        </section>

        <section className="canvas-video-clip-tools" aria-label="剪辑设置">
          <div className="canvas-video-clip-tool-group canvas-video-clip-volume"><div className="canvas-video-clip-tool-label"><span>音量</span><output>{Math.round(clip.volume * 100)}%</output></div><label><input aria-label="音量" type="range" min={0} max={1} step={0.05} value={clip.volume} disabled={clip.muted} onChange={(event) => setClip((current) => ({ ...current, volume: Number(event.target.value) }))} /></label></div>
          <div className="canvas-video-clip-tool-group canvas-video-clip-mute"><span className="canvas-video-clip-tool-label">声音</span><button type="button" className={`canvas-video-clip-mute-toggle${clip.muted ? " active" : ""}`} onClick={() => setClip((current) => ({ ...current, muted: !current.muted }))}>{clip.muted ? "已静音" : "静音"}</button></div>
          <div className="canvas-video-clip-tool-group canvas-video-clip-rate" role="group" aria-label="播放速度"><span className="canvas-video-clip-tool-label">速度</span>{([0.5, 1, 1.5, 2] as const).map((rate) => <button type="button" key={rate} className={clip.playbackRate === rate ? "active" : ""} onClick={() => setClip((current) => ({ ...current, playbackRate: rate }))}>{rate}x</button>)}</div>
          <div className="canvas-video-clip-tool-group canvas-video-clip-fit" role="group" aria-label={`显示方式：${fitLabel}`}><span className="canvas-video-clip-tool-label">画面</span><button type="button" className={clip.fit === "contain" ? "active" : ""} onClick={() => setClip((current) => ({ ...current, fit: "contain" }))}>完整显示</button><button type="button" className={clip.fit === "cover" ? "active" : ""} onClick={() => setClip((current) => ({ ...current, fit: "cover" }))}>填满裁切</button></div>
        </section>

        <footer className="canvas-video-clip-footer"><div className="canvas-video-clip-footer-note"><span aria-hidden="true">✓</span><p><b>生成新视频</b><small>会导出选定区间并生成可独立播放的新视频节点</small></p></div><div><button type="button" onClick={onClose} disabled={creating}>取消</button><button type="button" className="primary" disabled={!canCreate || creating} onClick={() => void createClip()}>{creating ? "正在生成…" : "创建剪辑"}</button></div></footer>
      </section>
    </div>
  );
}

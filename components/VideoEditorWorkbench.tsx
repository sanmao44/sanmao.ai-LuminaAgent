"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
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
  moveVideoEditorClip,
  normalizeVideoEditorState,
  removeVideoEditorClip,
  splitVideoEditorClip,
  toggleVideoEditorTrackMute,
  trimVideoEditorClip,
  updateVideoEditorClip,
} from "@/lib/canvas/video-editor";

type VideoEditorWorkbenchProps = {
  node: CanvasNode;
  document: CanvasDocument;
  onClose: () => void;
  onCreate: (state: CanvasVideoEditorState, selectedClipId: string | null) => void;
};

type TrimState = { clipId: string; edge: "start" | "end"; before: CanvasVideoEditorState } | null;
type MoveState = { clipId: string; track: CanvasVideoEditorTrack; offset: number; before: CanvasVideoEditorState } | null;
type PreviewMoveState = { clipId: string; startX: number; startY: number; pointerX: number; pointerY: number; before: CanvasVideoEditorState } | null;

const TRACKS: Array<{ id: CanvasVideoEditorTrack; label: string; icon: string }> = [
  { id: "video", label: "视频 · V1", icon: "▶" },
  { id: "audio", label: "音频 · A1", icon: "♫" },
  { id: "caption", label: "字幕", icon: "T" },
];

const MIN_CLIP_DURATION = 0.05;
const TRACK_LABEL_WIDTH = 112;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function secondsLabel(value: number, detailed = false) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${detailed && tenths ? `.${tenths}` : ""}`;
}

function sourceNodeForClip(document: CanvasDocument, clip: CanvasVideoEditorClip) {
  return clip.sourceNodeId ? document.nodes.find((item) => item.id === clip.sourceNodeId) : undefined;
}

function clipLabel(clip: CanvasVideoEditorClip) {
  return clip.text?.trim() || clip.name || (clip.type === "caption" ? "字幕" : "素材");
}

function aspectRatioFromText(value: unknown) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

const ASPECT_PRESETS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;
const RESOLUTION_PRESETS = ["720p", "1080p", "2K", "4K"] as const;

function projectDimensions(aspect: string, resolution: string | undefined) {
  const height = resolution === "720p" ? 720 : resolution === "2K" ? 1440 : resolution === "4K" ? 2160 : 1080;
  const ratio = aspectRatioFromText(aspect) || 16 / 9;
  const width = Math.max(1, Math.round(height * ratio));
  return { width, height };
}

export default function VideoEditorWorkbench({ node, document, onClose, onCreate }: VideoEditorWorkbenchProps) {
  const persistedState = useMemo(() => normalizeVideoEditorState(node.data.videoEditor), [node.data.videoEditor]);
  const [draft, setDraft] = useState(persistedState);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(persistedState.clips.find((clip) => clip.track === "video")?.id || null);
  const [playing, setPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(72);
  const [trim, setTrim] = useState<TrimState>(null);
  const [move, setMove] = useState<MoveState>(null);
  const [previewMove, setPreviewMove] = useState<PreviewMoveState>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [history, setHistory] = useState<CanvasVideoEditorState[]>([]);
  const [future, setFuture] = useState<CanvasVideoEditorState[]>([]);
  const [previewBounds, setPreviewBounds] = useState({ width: 0, viewportWidth: 0, viewportHeight: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const draftRef = useRef(persistedState);
  const previewColumnRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const videoLaneRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClipClickRef = useRef(false);
  const duration = Math.max(1, draft.projectDuration);
  const selectedClip = draft.clips.find((clip) => clip.id === selectedClipId) || null;
  const activeClips = clipsAtTime(draft, currentTime);
  const activeVideo = activeClips.find((clip) => clip.track === "video");
  const activeAudio = activeClips.find((clip) => clip.track === "audio");
  const activeCaption = activeClips.find((clip) => clip.track === "caption");
  const previewNode = activeVideo ? sourceNodeForClip(document, activeVideo) : undefined;
  const audioNode = activeAudio ? sourceNodeForClip(document, activeAudio) : undefined;
  const videoSourceAvailable = draft.clips.some((clip) => {
    const source = sourceNodeForClip(document, clip);
    return clip.track === "video" && source?.type === "media" && source.data.kind === "video" && Boolean(source.data.url);
  });

  useEffect(() => {
    const column = previewColumnRef.current;
    if (!column) return;
    const syncBounds = () => {
      setPreviewBounds({
        width: column.clientWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    };
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(column);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, []);

  useEffect(() => {
    setDraft(persistedState);
    draftRef.current = persistedState;
    setHistory([]);
    setFuture([]);
    setCurrentTime(0);
    setPlaying(false);
    setTrim(null);
    setMove(null);
    setPreviewMove(null);
    setSelectedClipId(persistedState.clips.find((clip) => clip.track === "video")?.id || null);
  }, [node.id, persistedState]);

  useEffect(() => {
    if (selectedClipId && !draft.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(null);
    }
    setCurrentTime((value) => Math.min(value, Math.max(1, draft.projectDuration)));
  }, [draft.clips, draft.projectDuration, selectedClipId]);

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
      const playbackRate = activeVideo.playbackRate || 1;
      const nextTime = Math.max(0, (currentTime - activeVideo.start) * playbackRate + activeVideo.sourceOffset);
      try {
        if (Math.abs(video.currentTime - nextTime) > 0.12) video.currentTime = nextTime;
      } catch {
        // The source can be replaced while metadata is loading; playback will
        // be synchronized again on the next render once the element is ready.
      }
      video.playbackRate = playbackRate;
      video.volume = draft.mutedTracks.includes("video") ? 0 : clamp(activeVideo.volume ?? 1, 0, 1);
      if (playing) void video.play().catch(() => setPlaying(false));
      else video.pause();
    } else {
      video?.pause();
    }
    const audio = audioRef.current;
    if (audio && activeAudio) {
      const nextTime = Math.max(0, currentTime - activeAudio.start + activeAudio.sourceOffset);
      try {
        if (Math.abs(audio.currentTime - nextTime) > 0.12) audio.currentTime = nextTime;
      } catch {
        // Ignore transient media state errors while an audio source is loading.
      }
      audio.volume = draft.mutedTracks.includes("audio") ? 0 : clamp(activeAudio.volume ?? 1, 0, 1);
      if (playing) void audio.play().catch(() => setPlaying(false));
      else audio.pause();
    } else {
      audio?.pause();
    }
  }, [activeAudio, activeVideo, currentTime, draft.mutedTracks, playing]);

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
      setPlaying((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const sameDraft = (left: CanvasVideoEditorState, right: CanvasVideoEditorState) => JSON.stringify(left) === JSON.stringify(right);
  const applyDraft = (next: CanvasVideoEditorState) => {
    const normalized = normalizeVideoEditorState(next);
    draftRef.current = normalized;
    setDraft(normalized);
  };
  const commitHistory = (previous: CanvasVideoEditorState, next: CanvasVideoEditorState) => {
    if (sameDraft(previous, next)) return;
    setHistory((stack) => [...stack, previous].slice(-50));
    setFuture([]);
  };
  const emit = (next: CanvasVideoEditorState) => {
    const normalized = normalizeVideoEditorState(next);
    if (sameDraft(draftRef.current, normalized)) return;
    commitHistory(draftRef.current, normalized);
    applyDraft(normalized);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    const current = draftRef.current;
    setHistory((stack) => stack.slice(0, -1));
    setFuture((stack) => [current, ...stack].slice(0, 50));
    applyDraft(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    const current = draftRef.current;
    setFuture((stack) => stack.slice(1));
    setHistory((stack) => [...stack, current].slice(-50));
    applyDraft(next);
  };
  const visibleTracks = TRACKS.filter((track) => track.id === "video" || draft.clips.some((clip) => clip.track === track.id));
  const timelineWidth = Math.max(560, duration * timelineZoom);
  const timelineLabelWidth = () => {
    const timeline = timelineRef.current;
    const lane = videoLaneRef.current;
    if (!timeline || !lane) return TRACK_LABEL_WIDTH;
    const timelineRect = timeline.getBoundingClientRect();
    const laneRect = lane.getBoundingClientRect();
    return Math.max(0, laneRect.left - timelineRect.left + timeline.scrollLeft);
  };
  const adjustTimelineZoom = (delta: number) => {
    const previous = timelineZoom;
    const next = clamp(previous + delta, 36, 180);
    if (next === previous) return;
    const timeline = timelineRef.current;
    const anchorTime = timeline
      ? Math.max(0, (timeline.scrollLeft + timeline.clientWidth / 2 - timelineLabelWidth()) / previous)
      : currentTime;
    setTimelineZoom(next);
    window.requestAnimationFrame(() => {
      if (!timeline) return;
      timeline.scrollLeft = Math.max(0, anchorTime * next + timelineLabelWidth() - timeline.clientWidth / 2);
    });
  };
  const projectAspect = aspectRatioFromText(draft.aspect) || 16 / 9;
  const projectSize = projectDimensions(draft.aspect, draft.resolution);
  // The editor viewport is the project canvas. Keep it fixed to the project
  // aspect and let `contain` add letterboxing inside it; changing the viewport
  // to the source ratio makes a portrait clip look like it fills the canvas
  // and encourages accidental cropping.
  const previewAspect = projectAspect;
  const previewFrameStyle = useMemo<CSSProperties>(() => {
    if (!previewBounds.width) return { aspectRatio: String(previewAspect) };
    // Keep the project viewport ratio while giving the compact layout enough room
    // for the inspector and timeline. The body becomes a vertical scroller on
    // narrow viewports, so the preview never overlaps the inspector.
    const cssHeightLimit = previewBounds.viewportWidth <= 560 ? 220 : previewBounds.viewportWidth <= 820 ? 260 : 420;
    const maxHeight = Math.max(180, Math.min(cssHeightLimit, previewBounds.viewportHeight * 0.42));
    const width = Math.min(previewBounds.width, maxHeight * previewAspect);
    return {
      width: `${Math.round(width)}px`,
      height: `${Math.round(width / previewAspect)}px`,
      aspectRatio: String(previewAspect),
    };
  }, [previewAspect, previewBounds]);
  const previewPlaybarStyle: CSSProperties = previewFrameStyle.width
    ? { width: previewFrameStyle.width, alignSelf: "center" }
    : {};
  // Kept as an explicit mode flag for backwards-compatible diagnostics; transforms now work in both fit modes.
  const previewContainsSource = false;
  const previewStyle: CSSProperties = {
    transform: previewContainsSource
      ? "translate(0px, 0px) scale(1)"
      : `translate(${(activeVideo?.x || 0) * 50}%, ${(activeVideo?.y || 0) * 50}%) scale(${activeVideo?.scale || 1})`,
    transformOrigin: "center center",
    opacity: activeVideo?.opacity ?? 1,
    objectFit: activeVideo?.fit || "contain",
  };

  const seek = (time: number, clearSelection = false) => {
    setPlaying(false);
    setCurrentTime(clamp(time, 0, duration));
    if (clearSelection) setSelectedClipId(null);
  };

  const setClipPatch = (patch: Partial<CanvasVideoEditorClip>) => {
    if (!selectedClip) return;
    emit(updateVideoEditorClip(draft, selectedClip.id, patch));
  };

  const splitCandidate = (() => {
    if (selectedClip && currentTime > selectedClip.start + MIN_CLIP_DURATION && currentTime < clipEnd(selectedClip) - MIN_CLIP_DURATION) return selectedClip;
    const active = draft.clips.find((clip) => clip.track === "video" && currentTime > clip.start + MIN_CLIP_DURATION && currentTime < clipEnd(clip) - MIN_CLIP_DURATION);
    return active || draft.clips.find((clip) => clip.track === "audio" && currentTime > clip.start + MIN_CLIP_DURATION && currentTime < clipEnd(clip) - MIN_CLIP_DURATION) || null;
  })();

  const splitSelected = () => {
    if (!splitCandidate) return;
    const next = splitVideoEditorClip(draft, splitCandidate.id, currentTime);
    if (next === draft) return;
    emit(next);
    setSelectedClipId(`${splitCandidate.id}-split-${Math.round(currentTime * 1000)}`);
  };

  const deleteSelected = () => {
    if (!selectedClip) return;
    const next = removeVideoEditorClip(draft, selectedClip.id);
    emit(next);
    setSelectedClipId(next.clips.find((clip) => clip.track === selectedClip.track)?.id || null);
  };

  const canSplitSelected = Boolean(splitCandidate);

  const timeFromClientX = (clientX: number) => {
    const timeline = timelineRef.current;
    if (!timeline) return 0;
    const rect = timeline.getBoundingClientRect();
    return clamp((clientX - rect.left + timeline.scrollLeft - timelineLabelWidth()) / timelineZoom, 0, duration);
  };

  const scrubFromClientX = (clientX: number, clearSelection = false) => {
    seek(timeFromClientX(clientX), clearSelection);
  };

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>, clearSelection = false) => {
    if (event.button !== 0 || trim) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    scrubFromClientX(event.clientX, clearSelection);
  };

  const continueScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    scrubFromClientX(event.clientX);
  };

  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setScrubbing(false);
  };

  const beginTrim = (event: ReactPointerEvent<HTMLButtonElement>, clipId: string, edge: "start" | "end") => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedClipId(clipId);
    setTrim({ clipId, edge, before: draftRef.current });
  };

  const snapMoveStart = (clip: CanvasVideoEditorClip, requested: number) => {
    const candidates = [0, ...draft.clips
      .filter((item) => item.id !== clip.id && item.track === clip.track)
      .flatMap((item) => [item.start, clipEnd(item)])];
    const threshold = Math.max(0.08, 10 / timelineZoom);
    const nearest = candidates.reduce<{ value: number; distance: number } | null>((best, value) => {
      const distance = Math.abs(value - requested);
      return distance <= threshold && (!best || distance < best.distance) ? { value, distance } : best;
    }, null);
    return Math.max(0, nearest?.value ?? requested);
  };

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>, clip: CanvasVideoEditorClip) => {
    if (event.button !== 0 || trim) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedClipId(clip.id);
    const point = timeFromClientX(event.clientX);
    setMove({ clipId: clip.id, track: clip.track, offset: point - clip.start, before: draftRef.current });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueMove = (clientX: number) => {
    if (!move) return;
    const clip = draftRef.current.clips.find((item) => item.id === move.clipId);
    if (!clip) return;
    const requested = timeFromClientX(clientX) - move.offset;
    const nextStart = snapMoveStart(clip, requested);
    if (Math.abs(nextStart - clip.start) > 0.002) suppressNextClipClickRef.current = true;
    applyDraft(moveVideoEditorClip(draftRef.current, clip.id, nextStart));
  };

  const beginPreviewMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeVideo || event.button !== 0 || trim || move) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, output")) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewMove({ clipId: activeVideo.id, startX: activeVideo.x || 0, startY: activeVideo.y || 0, pointerX: event.clientX, pointerY: event.clientY, before: draftRef.current });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePreviewMove = (clientX: number, clientY: number) => {
    if (!previewMove) return;
    const width = Math.max(1, previewBounds.width);
    const height = Math.max(1, previewFrameStyle.height ? Number.parseFloat(String(previewFrameStyle.height)) : width / projectAspect);
    const nextX = clamp(previewMove.startX + ((clientX - previewMove.pointerX) / width) * 2, -1, 1);
    const nextY = clamp(previewMove.startY + ((clientY - previewMove.pointerY) / height) * 2, -1, 1);
    applyDraft(updateVideoEditorClip(draftRef.current, previewMove.clipId, { x: nextX, y: nextY }));
  };

  const adjustPreviewScale = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!activeVideo) return;
    event.preventDefault();
    event.stopPropagation();
    const nextScale = clamp((activeVideo.scale || 1) * (event.deltaY > 0 ? 0.94 : 1.06), 0.1, 4);
    emit(updateVideoEditorClip(draft, activeVideo.id, { scale: Number(nextScale.toFixed(2)) }));
  };

  const continueTrim = (clientX: number) => {
    if (!trim) return;
    const clip = draft.clips.find((item) => item.id === trim.clipId);
    if (!clip) return;
    const source = sourceNodeForClip(document, clip);
    const sourceDurationMs = Number(source?.data.sourceDurationMs || source?.data.durationMs);
    const sourceDuration = Number.isFinite(sourceDurationMs) && sourceDurationMs > 0 ? sourceDurationMs / 1000 : 0;
    const playbackRate = clip.playbackRate || 1;
    const sourceEndOnTimeline = sourceDuration > clip.sourceOffset
      ? clip.start + (sourceDuration - clip.sourceOffset) / playbackRate
      : clipEnd(clip);
    const point = Math.min(timeFromClientX(clientX), duration, sourceEndOnTimeline);
    const start = trim.edge === "start" ? clamp(point, 0, clipEnd(clip) - MIN_CLIP_DURATION) : clip.start;
    const end = trim.edge === "end" ? Math.max(start + MIN_CLIP_DURATION, point) : clipEnd(clip);
    applyDraft(trimVideoEditorClip(draftRef.current, clip.id, start, end));
  };

  useEffect(() => {
    if (!trim) return;
    const handlePointerMove = (event: PointerEvent) => continueTrim(event.clientX);
    const handlePointerUp = () => {
      const current = draftRef.current;
      if (trim) commitHistory(trim.before, current);
      setTrim(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [trim, draft, duration, timelineZoom]);

  useEffect(() => {
    if (!move) return;
    const handlePointerMove = (event: PointerEvent) => continueMove(event.clientX);
    const handlePointerUp = () => {
      const current = draftRef.current;
      commitHistory(move.before, current);
      setMove(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [move, draft, timelineZoom, duration]);

  useEffect(() => {
    if (!previewMove) return;
    const handlePointerMove = (event: PointerEvent) => continuePreviewMove(event.clientX, event.clientY);
    const handlePointerUp = () => {
      const current = draftRef.current;
      commitHistory(previewMove.before, current);
      setPreviewMove(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [previewMove, previewBounds.width, previewFrameStyle.height, projectAspect]);

  useEffect(() => {
    if (!scrubbing) return;
    const handlePointerMove = (event: PointerEvent) => scrubFromClientX(event.clientX);
    const handlePointerUp = () => setScrubbing(false);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [scrubbing, duration, timelineZoom]);

  useEffect(() => {
    const handleEditingShortcuts = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.matches("input, textarea, select, button, [role=\"button\"], [contenteditable=\"true\"]") || target?.isContentEditable);
      if (typing) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          event.stopPropagation();
          redo();
          return;
        }
      }
      if (event.key.toLowerCase() === "s" && canSplitSelected) {
        event.preventDefault();
        splitSelected();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedClip) {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / Math.max(1, draft.fps);
        seek(currentTime + (event.key === "ArrowLeft" ? -step : step));
      }
    };
    window.addEventListener("keydown", handleEditingShortcuts, true);
    return () => window.removeEventListener("keydown", handleEditingShortcuts, true);
    }, [canSplitSelected, currentTime, deleteSelected, draft.fps, redo, selectedClip, splitSelected, undo]);

  return (
    <div className="canvas-modal-backdrop canvas-video-editor-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="canvas-workbench canvas-video-editor-workbench" role="dialog" aria-modal="true" aria-labelledby="canvas-video-editor-title" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="canvas-workbench-head">
          <div className="canvas-workbench-title"><span className="canvas-video-editor-icon" aria-hidden="true">✂</span><div><b id="canvas-video-editor-title">视频剪辑工作台</b><small>{String(node.data.name || "视频编辑节点")} · 草稿不会修改原视频</small></div></div>
          <div className="canvas-workbench-head-actions"><span className="canvas-video-editor-plan-badge">编辑草稿</span><button type="button" onClick={undo} disabled={!history.length} aria-label="撤销" title="撤销（Ctrl+Z）">↶</button><button type="button" onClick={redo} disabled={!future.length} aria-label="重做" title="重做（Ctrl+Shift+Z）">↷</button><button type="button" className="canvas-video-editor-create" onClick={() => onCreate(draft, selectedClipId)} disabled={!videoSourceAvailable}>创建剪辑</button><button type="button" onClick={onClose} aria-label="关闭视频剪辑工作台" title="关闭">×</button></div>
        </header>

        <div className="canvas-video-editor-body">
          <div className="canvas-video-editor-preview-column" ref={previewColumnRef}>
            <div className="canvas-video-editor-preview" style={previewFrameStyle} aria-label="视频剪辑预览" onPointerDown={beginPreviewMove} onWheel={adjustPreviewScale}>
              {previewNode?.data.url && previewNode.data.kind === "video" ? <video ref={videoRef} src={String(previewNode.data.url)} playsInline preload="metadata" style={previewStyle} onTimeUpdate={(event) => { if (!playing || !activeVideo) return; const playbackRate = activeVideo.playbackRate || 1; setCurrentTime(clamp(activeVideo.start + (event.currentTarget.currentTime - activeVideo.sourceOffset) / playbackRate, activeVideo.start, clipEnd(activeVideo))); }} /> : previewNode?.data.url && previewNode.data.kind === "image" ? <img src={String(previewNode.data.url)} alt={String(previewNode.data.name || "视频画面")} style={previewStyle} /> : <div className="canvas-video-editor-preview-empty"><span>✂</span><b>等待视频素材</b><small>连接一个视频节点后即可裁剪和创建新片段</small></div>}
              {activeCaption?.text && <div className="canvas-video-editor-caption-preview">{activeCaption.text}</div>}
              <span className="canvas-video-editor-timecode">{secondsLabel(currentTime, true)} / {secondsLabel(duration, true)}</span>
            </div>
            <div className="canvas-video-editor-playbar" style={previewPlaybarStyle}><button type="button" onClick={() => seek(0)} title="回到开头" aria-label="回到开头">|&lt;</button><button type="button" className="primary" onClick={() => setPlaying((value) => !value)} title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"}>{playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={() => seek(duration)} title="跳到结尾" aria-label="跳到结尾">&gt;|</button><input type="range" min="0" max={duration} step="0.01" value={Math.min(currentTime, duration)} onChange={(event) => seek(Number(event.target.value))} aria-label="播放头位置"/><output>{secondsLabel(currentTime, true)}</output></div>
          </div>
          {audioNode?.data.url && <audio ref={audioRef} className="canvas-video-editor-audio-source" src={String(audioNode.data.url)} preload="metadata" aria-hidden="true" />}

          <aside className="canvas-video-editor-inspector">
            <div className="canvas-video-editor-inspector-head"><b>检查器</b><small>{selectedClip ? clipLabel(selectedClip) : "剪辑草稿"}</small></div>
            {selectedClip ? <div className="canvas-video-editor-fields">
              <label><span>名称</span><input value={selectedClip.name} onChange={(event) => setClipPatch({ name: event.target.value })} /></label>
              {selectedClip.track === "caption" && <label><span>字幕</span><textarea value={selectedClip.text || ""} onChange={(event) => setClipPatch({ text: event.target.value })} /></label>}
              <div className="canvas-video-editor-field-grid"><label><span>开始时间</span><output>{secondsLabel(selectedClip.start, true)}</output></label><label><span>结束时间</span><output>{secondsLabel(clipEnd(selectedClip), true)}</output></label><label><span>时长</span><output>{secondsLabel(selectedClip.duration, true)}</output></label><label><span>源起点</span><output>{secondsLabel(selectedClip.sourceOffset, true)}</output></label></div>
              {selectedClip.track !== "caption" && <label className="canvas-video-editor-range-field"><span>音量</span><div><input aria-label="音量" type="range" min="0" max="1" step="0.05" value={Math.min(1, selectedClip.volume ?? 1)} onChange={(event) => setClipPatch({ volume: Number(event.target.value) })} /><output>{Math.round(Math.min(1, selectedClip.volume ?? 1) * 100)}%</output></div></label>}
              {selectedClip.track === "video" && <><div className="canvas-video-editor-choice"><span>速度</span><div>{([0.5, 1, 1.5, 2] as const).map((rate) => <button type="button" key={rate} className={(selectedClip.playbackRate || 1) === rate ? "active" : ""} onClick={() => setClipPatch({ playbackRate: rate })}>{rate}x</button>)}</div></div><div className="canvas-video-editor-choice"><span>显示方式</span><div><button type="button" className={(selectedClip.fit || "contain") === "contain" ? "active" : ""} onClick={() => setClipPatch({ fit: "contain" })}>适应</button><button type="button" className={selectedClip.fit === "cover" ? "active" : ""} onClick={() => setClipPatch({ fit: "cover" })}>填充</button></div></div><div className="canvas-video-editor-transform"><div className="canvas-video-editor-section-title"><b>画面变换</b><small>拖动预览或调整参数</small></div><label className="canvas-video-editor-range-field"><span>缩放</span><div><input aria-label="素材缩放" type="range" min="0.1" max="4" step="0.05" value={selectedClip.scale ?? 1} onChange={(event) => setClipPatch({ scale: Number(event.target.value) })} /><output>{Math.round((selectedClip.scale ?? 1) * 100)}%</output></div></label><label className="canvas-video-editor-range-field"><span>X 位置</span><div><input aria-label="素材 X 位置" type="range" min="-1" max="1" step="0.01" value={selectedClip.x ?? 0} onChange={(event) => setClipPatch({ x: Number(event.target.value) })} /><output>{(selectedClip.x ?? 0).toFixed(2)}</output></div></label><label className="canvas-video-editor-range-field"><span>Y 位置</span><div><input aria-label="素材 Y 位置" type="range" min="-1" max="1" step="0.01" value={selectedClip.y ?? 0} onChange={(event) => setClipPatch({ y: Number(event.target.value) })} /><output>{(selectedClip.y ?? 0).toFixed(2)}</output></div></label><label className="canvas-video-editor-range-field"><span>不透明度</span><div><input aria-label="素材不透明度" type="range" min="0" max="1" step="0.05" value={selectedClip.opacity ?? 1} onChange={(event) => setClipPatch({ opacity: Number(event.target.value) })} /><output>{Math.round((selectedClip.opacity ?? 1) * 100)}%</output></div></label><button type="button" className="canvas-video-editor-reset-transform" onClick={() => setClipPatch({ scale: 1, x: 0, y: 0, opacity: 1 })}>重置变换</button></div></>}
              <div className="canvas-video-editor-inspector-actions"><button type="button" onClick={splitSelected} disabled={!canSplitSelected} title="在播放头处分割">✂ 分割</button><button type="button" className="danger" onClick={deleteSelected} title="删除片段">删除</button></div>
            </div> : <div className="canvas-video-editor-inspector-empty"><b>未选择片段</b><small>点击时间轴中的片段查看属性，或点击空白查看项目状态。</small><div><span>项目时长</span><b>{secondsLabel(duration, true)}</b></div><div><span>视频片段</span><b>{draft.clips.filter((clip) => clip.track === "video").length} 个</b></div></div>}
            <div className="canvas-video-editor-inspector-footer"><button type="button" onClick={() => { const next = addVideoEditorCaption(draft, "新字幕", currentTime, 3); emit(next); setSelectedClipId(next.clips.at(-1)?.id || null); }}>＋ 添加字幕</button><span>{draft.clips.length} 个片段</span></div>
          </aside>
        </div>

        <div className="canvas-video-editor-timeline-shell">
          <div className="canvas-video-editor-timeline-toolbar">
            <div><b>时间线</b><small>{draft.aspect} · {projectSize.width}×{projectSize.height} · {draft.fps} fps · {secondsLabel(duration)}</small></div>
            <div className="canvas-video-editor-timeline-actions">
              <label className="canvas-video-editor-project-setting"><span>比例</span><select aria-label="项目比例" value={draft.aspect} onChange={(event) => emit({ ...draft, aspect: event.target.value })}>{ASPECT_PRESETS.map((aspect) => <option value={aspect} key={aspect}>{aspect}</option>)}</select></label>
              <label className="canvas-video-editor-project-setting"><span>分辨率</span><select aria-label="项目分辨率" value={draft.resolution || "1080p"} onChange={(event) => emit({ ...draft, resolution: event.target.value as CanvasVideoEditorState["resolution"] })}>{RESOLUTION_PRESETS.map((resolution) => <option value={resolution} key={resolution}>{resolution}</option>)}</select></label>
              <button type="button" onClick={splitSelected} disabled={!canSplitSelected} title="在播放头处分割（S）">✂ 分割 <kbd>S</kbd></button>
              <button type="button" onClick={deleteSelected} disabled={!selectedClip} title="删除所选片段（Delete）">删除 <kbd>Del</kbd></button>
              <div className="canvas-video-editor-zoom"><button type="button" onClick={() => adjustTimelineZoom(-12)} aria-label="缩小时间线" title="缩小时间线">−</button><span>{Math.round(timelineZoom)} px/s</span><button type="button" onClick={() => adjustTimelineZoom(12)} aria-label="放大时间线" title="放大时间线">＋</button></div>
            </div>
          </div>
          <div ref={timelineRef} className="canvas-video-editor-timeline" data-canvas-wheel-isolate>
            <div className="canvas-video-editor-timeline-ruler" style={{ width: timelineWidth }} onPointerDown={(event) => beginScrub(event, true)} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub}>{Array.from({ length: Math.floor(duration) + 1 }, (_, index) => <span key={index} style={{ left: index * timelineZoom }}>{secondsLabel(index)}</span>)}<i className="canvas-video-editor-playhead" style={{ left: currentTime * timelineZoom }} /></div>
            {visibleTracks.map((track) => {
              const trackClips = draft.clips.filter((clip) => clip.track === track.id);
              const muted = draft.mutedTracks.includes(track.id);
              return <div className={`canvas-video-editor-track-row track-${track.id}`} key={track.id}><div className="canvas-video-editor-track-label"><span>{track.icon}</span><b>{track.label}</b>{track.id !== "caption" && <button type="button" onClick={() => emit(toggleVideoEditorTrackMute(draft, track.id))} aria-label={muted ? `取消静音${track.label}` : `静音${track.label}`} title={muted ? "取消静音" : "静音"}>{muted ? "静" : "音"}</button>}</div><div ref={track.id === "video" ? videoLaneRef : undefined} className="canvas-video-editor-track-lane" style={{ width: timelineWidth }} onPointerDown={(event) => beginScrub(event, true)} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub}>{trackClips.map((clip) => <div key={clip.id} className={`canvas-video-editor-clip clip-${clip.type}${clip.id === selectedClipId ? " selected" : ""}`} style={{ left: clip.start * timelineZoom, width: Math.max(30, clip.duration * timelineZoom) }}><button type="button" className="canvas-video-editor-clip-select" onPointerDown={(event) => beginMove(event, clip)} onClick={() => { if (suppressNextClipClickRef.current) { suppressNextClipClickRef.current = false; return; } setSelectedClipId(clip.id); seek(clip.start); }} title={`${clipLabel(clip)} · ${secondsLabel(clip.duration, true)} · 拖动移动`}><span>{clip.type === "caption" ? "T" : track.icon}</span><b>{clipLabel(clip)}</b><small>{secondsLabel(clip.duration, true)}</small></button>{clip.id === selectedClipId && clip.track !== "caption" && <><button type="button" className="canvas-video-editor-trim start" aria-label="裁剪开始时间" onPointerDown={(event) => beginTrim(event, clip.id, "start")} /><button type="button" className="canvas-video-editor-trim end" aria-label="裁剪结束时间" onPointerDown={(event) => beginTrim(event, clip.id, "end")} /></>}</div>)}<i className="canvas-video-editor-playhead" style={{ left: currentTime * timelineZoom }} /></div></div>;
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

import type {
  CanvasVideoEditorClip,
  CanvasVideoEditorClipType,
  CanvasVideoEditorState,
  CanvasVideoEditorTrack,
} from "./types";

export type CanvasVideoEditorInput = {
  nodeId: string;
  kind: "image" | "video" | "audio";
  name?: string;
  durationSeconds?: number;
};

export const VIDEO_EDITOR_DEFAULT_FPS = 30;
export const VIDEO_EDITOR_DEFAULT_ASPECT = "16:9";
export const VIDEO_EDITOR_DEFAULT_RESOLUTION = "1080p" as const;

const TRACK_ORDER: CanvasVideoEditorTrack[] = ["video", "audio", "caption"];
const MIN_CLIP_DURATION = 0.05;

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTrack(value: unknown): CanvasVideoEditorTrack {
  return value === "audio" || value === "caption" ? value : "video";
}

function clipPlaybackRate(clip: Pick<CanvasVideoEditorClip, "playbackRate">) {
  return clip.playbackRate === 0.5 || clip.playbackRate === 1.5 || clip.playbackRate === 2
    ? clip.playbackRate
    : 1;
}

function normalizeClipType(value: unknown, track: CanvasVideoEditorTrack): CanvasVideoEditorClipType {
  if (value === "video" || value === "audio" || value === "caption") return value;
  if (value === "image") return "image";
  return track === "audio" ? "audio" : track === "caption" ? "caption" : "video";
}

function normalizeClip(value: unknown, index: number): CanvasVideoEditorClip | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CanvasVideoEditorClip>;
  const track = normalizeTrack(raw.track);
  const type = normalizeClipType(raw.type, track);
  const duration = clamp(finite(raw.duration, 1), 0.05, 24 * 60 * 60);
  const start = Math.max(0, finite(raw.start, 0));
  const sourceOffset = Math.max(0, finite(raw.sourceOffset, 0));
  const clip: CanvasVideoEditorClip = {
    id: String(raw.id || `clip-${index + 1}`),
    ...(raw.sourceNodeId ? { sourceNodeId: String(raw.sourceNodeId) } : {}),
    track,
    type,
    name: String(raw.name || (type === "caption" ? "字幕" : "素材")),
    start,
    duration,
    sourceOffset,
  };
  if (typeof raw.text === "string") clip.text = raw.text;
  if (raw.fontSize !== undefined) clip.fontSize = clamp(finite(raw.fontSize, 42), 12, 160);
  if (raw.captionBackgroundOpacity !== undefined) {
    clip.captionBackgroundOpacity = clamp(finite(raw.captionBackgroundOpacity, 0.68), 0, 1);
  }
  if (raw.scale !== undefined) clip.scale = clamp(finite(raw.scale, 1), 0.1, 4);
  if (raw.opacity !== undefined) clip.opacity = clamp(finite(raw.opacity, 1), 0, 1);
  if (raw.x !== undefined) clip.x = clamp(finite(raw.x, 0), -1, 1);
  if (raw.y !== undefined) clip.y = clamp(finite(raw.y, 0), -1, 1);
  if (raw.volume !== undefined) clip.volume = clamp(finite(raw.volume, 1), 0, 2);
  if (raw.playbackRate !== undefined) {
    const playbackRate = finite(raw.playbackRate, 1);
    clip.playbackRate = playbackRate === 0.5 || playbackRate === 1.5 || playbackRate === 2 ? playbackRate : 1;
  }
  if (raw.fit !== undefined) clip.fit = raw.fit === "cover" ? "cover" : "contain";
  if (raw.fadeIn !== undefined) clip.fadeIn = clamp(finite(raw.fadeIn, 0), 0, duration);
  return clip;
}

export function normalizeVideoEditorState(value: unknown): CanvasVideoEditorState {
  const raw = value && typeof value === "object" ? value as Partial<CanvasVideoEditorState> : {};
  const clips = Array.isArray(raw.clips)
    ? raw.clips.map(normalizeClip).filter((clip): clip is CanvasVideoEditorClip => Boolean(clip))
    : [];
  const mutedTracks = Array.isArray(raw.mutedTracks)
    ? [...new Set(raw.mutedTracks.filter((track): track is CanvasVideoEditorTrack => TRACK_ORDER.includes(track as CanvasVideoEditorTrack)).map(normalizeTrack))]
    : [];
  const disabledTracks = Array.isArray(raw.disabledTracks)
    ? [...new Set(raw.disabledTracks.filter((track): track is CanvasVideoEditorTrack => TRACK_ORDER.includes(track as CanvasVideoEditorTrack)).map(normalizeTrack))]
    : [];
  // A video track is a sequential edit lane. Repair legacy/manual overlap data
  // on load so clips can never hide one another on the same video layer.
  const videoPositions = new Map<string, number>();
  let videoCursor = 0;
  clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => clip.track === "video")
    .sort((a, b) => a.clip.start - b.clip.start || a.index - b.index)
    .forEach(({ clip }) => {
      const start = Math.max(clip.start, videoCursor);
      videoPositions.set(clip.id, start);
      videoCursor = start + clip.duration;
    });
  const positionedClips = clips.map((clip) => {
    const start = videoPositions.get(clip.id);
    return start === undefined || start === clip.start ? clip : { ...clip, start };
  });
  const maxEnd = positionedClips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  return {
    version: 1,
    projectDuration: Math.max(maxEnd, finite(raw.projectDuration, maxEnd)),
    fps: clamp(Math.round(finite(raw.fps, VIDEO_EDITOR_DEFAULT_FPS)), 1, 120),
    aspect: typeof raw.aspect === "string" && raw.aspect.trim() ? raw.aspect.trim() : VIDEO_EDITOR_DEFAULT_ASPECT,
    resolution: raw.resolution === "720p" || raw.resolution === "2K" || raw.resolution === "4K" ? raw.resolution : VIDEO_EDITOR_DEFAULT_RESOLUTION,
    clips: positionedClips,
    mutedTracks,
    disabledTracks,
  };
}

export function createVideoEditorState(
  inputs: readonly CanvasVideoEditorInput[] = [],
): CanvasVideoEditorState {
  return syncVideoEditorInputs(
    {
      version: 1,
      projectDuration: 0,
      fps: VIDEO_EDITOR_DEFAULT_FPS,
      aspect: VIDEO_EDITOR_DEFAULT_ASPECT,
      resolution: VIDEO_EDITOR_DEFAULT_RESOLUTION,
      clips: [],
      mutedTracks: [],
      disabledTracks: [],
    },
    inputs,
  );
}

export function defaultVideoEditorDuration(input: Pick<CanvasVideoEditorInput, "kind" | "durationSeconds">) {
  const sourceDuration = Number(input.durationSeconds);
  if (Number.isFinite(sourceDuration) && sourceDuration > 0) return Math.max(0.05, sourceDuration);
  return input.kind === "video" ? 5 : input.kind === "audio" ? 20 : 3;
}

function clipForInput(input: CanvasVideoEditorInput, start: number): CanvasVideoEditorClip {
  const isAudio = input.kind === "audio";
  return {
    id: `clip-${input.nodeId}`,
    sourceNodeId: input.nodeId,
    track: isAudio ? "audio" : "video",
    type: input.kind,
    name: input.name || (isAudio ? "音频素材" : input.kind === "video" ? "视频素材" : "图片素材"),
    start,
    duration: defaultVideoEditorDuration(input),
    sourceOffset: 0,
    scale: 1,
    opacity: 1,
    volume: 1,
    ...(input.kind === "video" ? { playbackRate: 1 as const, fit: "contain" as const } : {}),
  };
}

function sameClip(a: CanvasVideoEditorClip, b: CanvasVideoEditorClip) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reconcile connected media inputs without overwriting manual clip edits.
 * Existing source ids retain their positions; newly connected sources append
 * after the current track, and disconnected sources are removed.
 */
export function syncVideoEditorInputs(
  value: CanvasVideoEditorState,
  inputs: readonly CanvasVideoEditorInput[],
): CanvasVideoEditorState {
  const current = normalizeVideoEditorState(value);
  const validInputs = inputs.filter((input, index, all) =>
    input.nodeId && all.findIndex((candidate) => candidate.nodeId === input.nodeId) === index,
  );
  const inputIds = new Set(validInputs.map((input) => input.nodeId));
  const retained = current.clips.filter((clip) =>
    clip.track === "caption" || (clip.sourceNodeId && inputIds.has(clip.sourceNodeId)),
  );
  const retainedBySource = new Map(
    retained.filter((clip) => clip.sourceNodeId).map((clip) => [clip.sourceNodeId!, clip]),
  );
  const next = [...retained];
  const trackEnd = (track: CanvasVideoEditorTrack) => next
    .filter((clip) => clip.track === track)
    .reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
  for (const input of validInputs) {
    if (retainedBySource.has(input.nodeId)) continue;
    const track = input.kind === "audio" ? "audio" : "video";
    next.push(clipForInput(input, trackEnd(track)));
  }
  const projectDuration = next.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
  const unchanged =
    projectDuration === current.projectDuration &&
    next.length === current.clips.length &&
    next.every((clip, index) => sameClip(clip, current.clips[index]));
  return unchanged ? current : { ...current, clips: next, projectDuration };
}

export function clipEnd(clip: Pick<CanvasVideoEditorClip, "start" | "duration">) {
  return clip.start + clip.duration;
}

export function clipsAtTime(state: CanvasVideoEditorState, time: number) {
  const point = Math.max(0, time);
  return state.clips.filter((clip) =>
    !state.disabledTracks?.includes(clip.track) && point >= clip.start && point < clipEnd(clip),
  );
}

function neighboringVideoClips(state: CanvasVideoEditorState, clip: CanvasVideoEditorClip) {
  if (clip.track !== "video") return { previous: undefined, next: undefined };
  const peers = state.clips
    .filter((item) => item.id !== clip.id && item.track === "video")
    .sort((a, b) => a.start - b.start);
  return {
    previous: peers.filter((item) => item.start < clip.start).at(-1),
    next: peers.find((item) => item.start >= clip.start),
  };
}

export function updateVideoEditorClip(
  state: CanvasVideoEditorState,
  clipId: string,
  patch: Partial<CanvasVideoEditorClip>,
): CanvasVideoEditorState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const currentRate = clipPlaybackRate(clip);
    const nextRate = clipPlaybackRate({ playbackRate: patch.playbackRate ?? currentRate });
    // A clip duration is measured on the project timeline. When only speed
    // changes, retain the same source range and derive its new output length.
    const duration = clamp(
      patch.duration === undefined
        ? clip.duration * currentRate / nextRate
        : finite(patch.duration, clip.duration),
      0.05,
      24 * 60 * 60,
    );
    return normalizeClip({ ...clip, ...patch, duration }, 0) || clip;
  });
  const projectDuration = clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  return { ...state, clips, projectDuration };
}

/** Move a clip on its track without changing its source range or duration. */
export function moveVideoEditorClip(
  state: CanvasVideoEditorState,
  clipId: string,
  start: number,
): CanvasVideoEditorState {
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip) return state;
  const requestedStart = Math.max(0, finite(start, clip.start));
  if (clip.track !== "video") return updateVideoEditorClip(state, clipId, { start: requestedStart });
  const { previous, next } = neighboringVideoClips(state, clip);
  const minimum = previous ? clipEnd(previous) : 0;
  const maximum = next ? Math.max(minimum, next.start - clip.duration) : Number.POSITIVE_INFINITY;
  return updateVideoEditorClip(state, clipId, { start: Math.min(maximum, Math.max(minimum, requestedStart)) });
}

export function removeVideoEditorClip(state: CanvasVideoEditorState, clipId: string) {
  const clips = state.clips.filter((clip) => clip.id !== clipId);
  return {
    ...state,
    clips,
    projectDuration: clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0),
  };
}

export function splitVideoEditorClip(
  state: CanvasVideoEditorState,
  clipId: string,
  splitAt: number,
): CanvasVideoEditorState {
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip) return state;
  const point = Number(splitAt);
  const relative = point - clip.start;
  if (!Number.isFinite(relative) || relative <= 0.05 || relative >= clip.duration - 0.05) return state;
  const firstDuration = relative;
  const second: CanvasVideoEditorClip = {
    ...clip,
    id: `${clip.id}-split-${Math.round(point * 1000)}`,
    start: point,
    duration: clip.duration - firstDuration,
    sourceOffset: clip.sourceOffset + firstDuration * clipPlaybackRate(clip),
  };
  const clips = state.clips.flatMap((item) => item.id === clipId
    ? [{ ...item, duration: firstDuration }, second]
    : [item]);
  return {
    ...state,
    clips,
    projectDuration: clips.reduce((max, item) => Math.max(max, clipEnd(item)), 0),
  };
}

export function trimVideoEditorClip(
  state: CanvasVideoEditorState,
  clipId: string,
  start: number,
  end: number,
): CanvasVideoEditorState {
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip) return state;
  const { previous, next } = neighboringVideoClips(state, clip);
  const minimumStart = previous ? clipEnd(previous) : 0;
  const maximumEnd = next ? next.start : Number.POSITIVE_INFINITY;
  const requestedStart = Math.max(0, finite(start, clip.start));
  const requestedEnd = Math.max(requestedStart + MIN_CLIP_DURATION, finite(end, clipEnd(clip)));
  const nextStart = clip.track === "video"
    ? Math.min(maximumEnd - MIN_CLIP_DURATION, Math.max(minimumStart, requestedStart))
    : requestedStart;
  const nextEnd = clip.track === "video"
    ? Math.min(maximumEnd, Math.max(nextStart + MIN_CLIP_DURATION, requestedEnd))
    : requestedEnd;
  const leftTrim = Math.max(0, nextStart - clip.start);
  const nextDuration = nextEnd - nextStart;
  return updateVideoEditorClip(state, clipId, {
    start: nextStart,
    duration: nextDuration,
    sourceOffset: clip.sourceOffset + leftTrim * clipPlaybackRate(clip),
  });
}

export function reorderVideoEditorClips(
  state: CanvasVideoEditorState,
  track: CanvasVideoEditorTrack,
  orderedIds: readonly string[],
): CanvasVideoEditorState {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const clips = state.clips.slice().sort((a, b) => {
    if (a.track !== track || b.track !== track) return 0;
    return (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  });
  let cursor = 0;
  const positioned = clips.map((clip) => {
    if (clip.track !== track) return clip;
    const next = { ...clip, start: cursor };
    cursor += next.duration;
    return next;
  });
  return { ...state, clips: positioned, projectDuration: positioned.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0) };
}

export function addVideoEditorCaption(
  state: CanvasVideoEditorState,
  text = "新字幕",
  start = 0,
  duration = 3,
): CanvasVideoEditorState {
  const safeDuration = clamp(Number(duration) || 3, 0.05, 24 * 60 * 60);
  const requestedStart = Math.max(0, Number(start) || 0);
  const captionClips = state.clips.filter((clip) => clip.track === "caption");
  let safeStart = requestedStart;
  // Keep one caption track readable: when the playhead is inside an existing
  // caption, place the new caption after the blocking range instead of
  // stacking two clips at the same time and hiding one in preview.
  while (captionClips.some((clip) => safeStart < clipEnd(clip) && safeStart + safeDuration > clip.start)) {
    safeStart = captionClips
      .filter((clip) => safeStart < clipEnd(clip) && safeStart + safeDuration > clip.start)
      .reduce((end, clip) => Math.max(end, clipEnd(clip)), safeStart);
  }
  const clip: CanvasVideoEditorClip = {
    id: `caption-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    track: "caption",
    type: "caption",
    name: "字幕",
    start: safeStart,
    duration: safeDuration,
    sourceOffset: 0,
    text,
    fontSize: 42,
    captionBackgroundOpacity: 0.68,
    scale: 1,
    opacity: 1,
    x: 0,
    y: 0.35,
  };
  const clips = [...state.clips, clip];
  return { ...state, clips, projectDuration: Math.max(state.projectDuration, clipEnd(clip)) };
}

export function toggleVideoEditorTrackMute(
  state: CanvasVideoEditorState,
  track: CanvasVideoEditorTrack,
) {
  const muted = new Set(state.mutedTracks);
  if (muted.has(track)) muted.delete(track);
  else muted.add(track);
  return { ...state, mutedTracks: TRACK_ORDER.filter((item) => muted.has(item)) };
}

export function toggleVideoEditorTrackEnabled(
  state: CanvasVideoEditorState,
  track: CanvasVideoEditorTrack,
) {
  const disabled = new Set(state.disabledTracks || []);
  if (disabled.has(track)) disabled.delete(track);
  else disabled.add(track);
  return { ...state, disabledTracks: TRACK_ORDER.filter((item) => disabled.has(item)) };
}

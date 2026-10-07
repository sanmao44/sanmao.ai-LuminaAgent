import type { CanvasVideoClipState } from './types';

export const VIDEO_CLIP_MIN_DURATION = 0.1;

function finiteVideoClipValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampVideoClipValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVideoClipPlaybackRate(value: unknown): CanvasVideoClipState['playbackRate'] {
  const rate = finiteVideoClipValue(value, 1);
  return rate === 0.5 || rate === 1.5 || rate === 2 ? rate : 1;
}

/**
 * Sanitizes persisted clip data without needing to decode or rewrite a video.
 * `sourceDurationSeconds` is optional because imported media can be restored
 * before its metadata event has fired.
 */
export function normalizeCanvasVideoClipState(
  value: unknown,
  sourceDurationSeconds?: number,
): CanvasVideoClipState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<CanvasVideoClipState>;
  const sourceDuration = finiteVideoClipValue(sourceDurationSeconds, 0);
  const maxEnd = sourceDuration > VIDEO_CLIP_MIN_DURATION ? sourceDuration : Number.POSITIVE_INFINITY;
  const startTime = clampVideoClipValue(finiteVideoClipValue(raw.startTime, 0), 0, Math.max(0, maxEnd - VIDEO_CLIP_MIN_DURATION));
  const rawEnd = finiteVideoClipValue(raw.endTime, sourceDuration > VIDEO_CLIP_MIN_DURATION ? sourceDuration : startTime + 1);
  const endTime = Math.max(
    startTime + VIDEO_CLIP_MIN_DURATION,
    clampVideoClipValue(rawEnd, startTime + VIDEO_CLIP_MIN_DURATION, maxEnd),
  );
  return {
    version: 1,
    ...(typeof raw.sourceNodeId === 'string' && raw.sourceNodeId ? { sourceNodeId: raw.sourceNodeId } : {}),
    startTime,
    endTime,
    volume: clampVideoClipValue(finiteVideoClipValue(raw.volume, 1), 0, 1),
    muted: raw.muted === true,
    playbackRate: normalizeVideoClipPlaybackRate(raw.playbackRate),
    fit: raw.fit === 'cover' ? 'cover' : 'contain',
    ...(raw.scale !== undefined ? { scale: clampVideoClipValue(finiteVideoClipValue(raw.scale, 1), 0.1, 4) } : {}),
    ...(raw.x !== undefined ? { x: clampVideoClipValue(finiteVideoClipValue(raw.x, 0), -1, 1) } : {}),
    ...(raw.y !== undefined ? { y: clampVideoClipValue(finiteVideoClipValue(raw.y, 0), -1, 1) } : {}),
    ...(raw.opacity !== undefined ? { opacity: clampVideoClipValue(finiteVideoClipValue(raw.opacity, 1), 0, 1) } : {}),
  };
}

export function videoClipDurationSeconds(clip: Pick<CanvasVideoClipState, 'startTime' | 'endTime' | 'playbackRate'>) {
  return Math.max(0, (clip.endTime - clip.startTime) / clip.playbackRate);
}

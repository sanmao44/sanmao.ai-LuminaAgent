import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpeg } from '../video-trim-service';
import { resolveStoredFileWithFallback } from '../image-storage';
import { resolveStoredVideoFileWithFallback } from '../video-storage';
import { resolveStoredAudioFileWithFallback } from '../audio-storage';
import { persistVideoBuffer } from '../video-storage';
import type { CloneJob, CloneOptions, CloneShot, CloneTimeline, CloneTimelineTrackClip } from './types';
import type { CanvasVideoEditorClip, CanvasVideoEditorLayout, CanvasVideoEditorTrack, CanvasVideoEditorTransition, CanvasVideoEditorWord } from '../canvas/types';
import { videoEditorTextBox } from '../canvas/video-editor';
import { fitCanvasText } from '../canvas/text-layout';
import { runFfmpegCapture, extractVideoSegment, probeMediaSeconds } from './media';

type AssemblyInput = {
  job: CloneJob;
  timeline: CloneTimeline;
  workingDirectory: string;
  imageStoragePath?: string;
  videoStoragePath?: string;
  audioStoragePath?: string;
  referenceFile?: string;
  onProgress?: (progress: number) => Promise<void> | void;
};

type RenderOverlay = {
  text: string;
  start: number;
  end: number;
  style?: string;
  position?: string;
  bounds?: TextBox;
  options?: TextRenderOptions;
};

type EventVisual = {
  file: string;
  isVideo: boolean;
  start: number;
  end: number;
  sourceOffset: number;
};

type ResolvedSources = {
  visual: string | null;
  visualIsVideo: boolean;
  referenceFrameFallback: boolean;
  visualOffset: number;
  visualRate: number;
  visualFit: 'contain' | 'cover';
  visualScale: number;
  visualX: number;
  visualY: number;
  visualOpacity: number;
  audio: string | null;
  audioOffset: number;
  audioVolume: number;
  audioRate: number;
  ambient: string | null;
  ambientVolume: number;
  ambientRate: number;
  duckAmbient: boolean;
};
type TextBox = { x: number; y: number; width: number; height: number };

function timelineTrack(input: AssemblyInput, kind: 'video' | 'reference-audio' | 'voice' | 'caption' | 'graphics') {
  return input.timeline.tracks?.find((track) => track.kind === kind) || null;
}

function editorTrackFor(kind: 'video' | 'reference-audio' | 'voice' | 'caption' | 'graphics'): CanvasVideoEditorTrack {
  return kind === 'voice' ? 'audio' : kind;
}

function editorTrackEnabled(input: AssemblyInput, track: CanvasVideoEditorTrack) {
  const state = input.timeline.editorState;
  return !state || !state.disabledTracks?.includes(track);
}

function editorTrackAudioEnabled(input: AssemblyInput, track: CanvasVideoEditorTrack) {
  const state = input.timeline.editorState;
  return editorTrackEnabled(input, track) && !state?.mutedTracks.includes(track);
}

function shotIndexForClip(clip: Pick<CanvasVideoEditorClip, 'shotIndex' | 'sourceClipId' | 'id'>, fallback: number) {
  if (Number.isInteger(clip.shotIndex) && (clip.shotIndex || 0) >= 0) return clip.shotIndex as number;
  const match = String(clip.sourceClipId || clip.id).match(/(?:clone-(?:video|audio|caption|graphics|reference-audio)-)(\d+)/u);
  return match ? Number(match[1]) : fallback;
}

function editorClipForShot(input: AssemblyInput, kind: 'video' | 'reference-audio' | 'voice' | 'caption' | 'graphics', shotIndex: number) {
  if (!input.timeline.editorState || !editorTrackEnabled(input, editorTrackFor(kind))) return null;
  const track = editorTrackFor(kind);
  return input.timeline.editorState.clips
    .filter((clip) => clip.track === track)
    .find((clip) => shotIndexForClip(clip, -1) === shotIndex) || null;
}

function editorClipForSegment(
  input: AssemblyInput,
  kind: 'reference-audio' | 'voice',
  shotIndex: number,
  start: number,
  duration: number,
) {
  if (!input.timeline.editorState || !editorTrackEnabled(input, editorTrackFor(kind))) return null;
  const track = editorTrackFor(kind);
  const clips = input.timeline.editorState.clips.filter((clip) =>
    clip.track === track && clip.start < start + duration && clip.start + clip.duration > start,
  );
  return clips
    .sort((a, b) => {
      const aShot = shotIndexForClip(a, -1) === shotIndex ? 1 : 0;
      const bShot = shotIndexForClip(b, -1) === shotIndex ? 1 : 0;
      if (aShot !== bShot) return bShot - aShot;
      const aOverlap = Math.min(a.start + a.duration, start + duration) - Math.max(a.start, start);
      const bOverlap = Math.min(b.start + b.duration, start + duration) - Math.max(b.start, start);
      return bOverlap - aOverlap;
    })[0] || null;
}

function editorOverlayForSegment(
  input: AssemblyInput,
  track: 'caption' | 'graphics',
  start: number,
  duration: number,
) {
  const state = input.timeline.editorState;
  if (!state || !editorTrackEnabled(input, track)) return null;
  return state.clips
    .filter((clip) => clip.track === track && clip.start < start + duration && clip.start + clip.duration > start)
    .sort((a, b) => a.start - b.start)
    .at(-1) || null;
}

function graphicsClipsForSegment(input: AssemblyInput, shotIndex: number, start: number, duration: number) {
  const end = start + duration;
  if (input.timeline.editorState) {
    if (!editorTrackEnabled(input, 'graphics')) return [] as Array<CanvasVideoEditorClip | CloneTimelineTrackClip>;
    return input.timeline.editorState.clips
      .filter((clip) => clip.track === 'graphics' && clip.start < end && clip.start + clip.duration > start)
      .sort((a, b) => a.start - b.start);
  }
  const semantic = timelineTrack(input, 'graphics')?.clips.filter((clip) => clip.shotIndex === shotIndex && clip.start < end && clip.start + clip.duration > start) || [];
  if (semantic.length) return semantic;
  return input.timeline.clips
    .filter((clip) => clip.track === 'graphics' && shotIndexForClip(clip, -1) === shotIndex && clip.start < end && clip.start + clip.duration > start)
    .sort((a, b) => a.start - b.start);
}

function timelineTrackClip(input: AssemblyInput, kind: 'reference-audio' | 'voice' | 'caption' | 'graphics', shotIndex: number) {
  const edited = editorClipForShot(input, kind, shotIndex);
  if (input.timeline.editorState && !edited) return null;
  const base = timelineTrack(input, kind)?.clips.find((clip) => clip.shotIndex === shotIndex) || null;
  return edited ? { ...base, ...edited, ...(base?.url ? { url: base.url } : {}) } : base;
}

function componentForShot(input: AssemblyInput, shotIndex: number) {
  const clip = input.timeline.tracks?.find((track) => track.kind === 'video')?.clips.find((item) => item.shotIndex === shotIndex);
  return clip?.componentId || input.timeline.clips.find((item) => item.track === 'video' && item.shotIndex === shotIndex)?.componentId;
}

function audioTempoFilters(rate: number) {
  const safe = Math.max(0.5, Math.min(2, Number(rate) || 1));
  return safe === 1 ? '' : `,atempo=${safe.toFixed(3)}`;
}

function normalizedClipVolume(value: unknown, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const volume = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(0, Math.min(2, volume));
}

function timelineAudioClip(
  input: AssemblyInput,
  shot: CloneShot,
  index: number,
  start: number,
  duration: number,
) {
  if (!editorTrackAudioEnabled(input, 'audio')) return null;
  const track = timelineTrack(input, 'voice');
  if (!track && !input.timeline.editorState) return shot.audioUrl ? { url: shot.audioUrl, sourceOffset: 0, volume: 1 } : null;
  const edited = editorClipForSegment(input, 'voice', index, start, duration);
  if (input.timeline.editorState && !edited) return null;
  const base = track?.clips.find((clip) => clip.shotIndex === index) || null;
  const clip = edited ? { ...base, ...edited, ...(base?.url ? { url: base.url } : {}) } : base;
  if (!clip || clip.enabled === false || !clip.url) return null;
  return {
    url: clip.url,
    sourceOffset: Math.max(0, Number(clip.sourceOffset) || 0) + Math.max(0, start - clip.start) * (clip.playbackRate || 1),
    volume: normalizedClipVolume(clip.volume, 1),
    rate: clip.playbackRate || 1,
  };
}

function timelineVideoClip(input: AssemblyInput, shot: CloneShot, index: number, preferred?: CanvasVideoEditorClip) {
  const edited = preferred || editorClipForShot(input, 'video', index);
  if (edited) {
    return {
      url: shot.videoUrl || shot.imageUrl,
      enabled: editorTrackEnabled(input, 'video'),
      source: shot.preserveReferenceFrame ? 'reference-video' : 'generated-media' as const,
      duration: edited.duration,
      sourceOffset: edited.sourceOffset,
      fit: edited.fit,
      playbackRate: edited.playbackRate,
      scale: edited.scale,
      x: edited.x,
      y: edited.y,
      opacity: edited.opacity,
      layout: edited.layout,
      motionPath: edited.motionPath,
    };
  }
  const track = timelineTrack(input, 'video');
  if (!track) return { url: shot.videoUrl || shot.imageUrl, enabled: true, source: shot.preserveReferenceFrame ? 'reference-video' : 'generated-media' as const, duration: Math.max(0.1, shot.end - shot.start), sourceOffset: shot.start };
  const clip = track.clips.find((item) => item.shotIndex === index);
  return {
    url: clip?.url || shot.videoUrl || shot.imageUrl,
    enabled: clip?.enabled !== false,
    source: clip?.source || (shot.preserveReferenceFrame ? 'reference-video' : 'generated-media' as const),
    duration: clip?.duration || Math.max(0.1, shot.end - shot.start),
    sourceOffset: clip?.sourceOffset ?? (shot.preserveReferenceFrame ? shot.start : 0),
    fit: undefined,
    playbackRate: undefined,
    scale: undefined,
    x: undefined,
    y: undefined,
    opacity: undefined,
    layout: undefined,
    motionPath: undefined,
  };
}

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

function projectDimensions(aspect: string, resolution?: '720p' | '1080p' | '2K' | '4K') {
  const match = String(aspect || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/u);
  const parsed = match ? Number(match[1]) / Number(match[2]) : 16 / 9;
  const ratio = Number.isFinite(parsed) && parsed > 0 ? parsed : 16 / 9;
  const height = resolution === '720p' ? 720 : resolution === '2K' ? 1440 : resolution === '4K' ? 2160 : 1080;
  return { width: Math.max(2, Math.round(height * ratio / 2) * 2), height };
}

function safeExtension(value: string, fallback: string) {
  const ext = path.extname(value).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/u.test(ext) ? ext : fallback;
}

function escapeFilterPath(value: string) {
  return value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function safeFilterColor(value: string | undefined, fallback: string) {
  const color = String(value || '').trim().slice(0, 48);
  return /^#[0-9a-f]{3,8}$/iu.test(color) || /^(?:rgba?|hsla?)\([^)]{1,80}\)$/iu.test(color) || /^[a-z]{3,20}$/iu.test(color)
    ? color
    : fallback;
}

function layoutRegion(layout: CanvasVideoEditorLayout | undefined, dimensions: { width: number; height: number }, secondary = false) {
  if (!layout || (!secondary && layout.mode === 'full') || (secondary && (layout.mode === 'full' || layout.mode === 'card'))) return null;
  const gap = Math.max(0, Math.min(0.2, Number(layout.gap) || 0.02));
  const padding = Math.max(0, Math.min(0.2, Number(layout.padding) || 0.06));
  const fallback = secondary
    ? layout.mode === 'split-horizontal'
      ? { x: 0.5 + gap / 2, y: 0, width: 0.5 - gap / 2, height: 1 }
      : layout.mode === 'split-vertical'
        ? { x: 0, y: 0.5 + gap / 2, width: 1, height: 0.5 - gap / 2 }
        : { x: 0.64, y: 0.64, width: 0.3, height: 0.3 }
    : layout.mode === 'split-horizontal'
      ? { x: 0, y: 0, width: 0.5 - gap / 2, height: 1 }
      : layout.mode === 'split-vertical'
        ? { x: 0, y: 0, width: 1, height: 0.5 - gap / 2 }
        : layout.mode === 'card'
          ? { x: padding, y: padding, width: 1 - padding * 2, height: 1 - padding * 2 }
          : { x: 0, y: 0, width: 1, height: 1 };
  const region = secondary ? layout.secondary || fallback : layout.primary || fallback;
  const x = Math.max(0, Math.min(dimensions.width - 2, Math.round(region.x * dimensions.width / 2) * 2));
  const y = Math.max(0, Math.min(dimensions.height - 2, Math.round(region.y * dimensions.height / 2) * 2));
  const width = Math.max(2, Math.min(dimensions.width - x, Math.round(region.width * dimensions.width / 2) * 2));
  const height = Math.max(2, Math.min(dimensions.height - y, Math.round(region.height * dimensions.height / 2) * 2));
  return { x, y, width, height };
}

function captionPlacement(position?: string) {
  const value = String(position || '').toLowerCase();
  const x = value.includes('left') ? '48' : value.includes('right') ? 'w-text_w-48' : '(w-text_w)/2';
  const y = value.includes('top') ? '56' : value.includes('bottom') ? 'h-text_h-56' : '(h-text_h)/2';
  return { x, y };
}

function graphicsDrawTextOptions(style?: string, backgroundOpacity = 0.72, fontSize = 60) {
  const value = String(style || '').toLocaleLowerCase();
  if (/card|box|solid|label|tag|banner|色块|卡片|标签|底板/u.test(value)) {
    return `box=1:boxcolor=black@${Math.max(0, Math.min(1, backgroundOpacity)).toFixed(2)}:boxborderw=${Math.max(4, Math.round(fontSize * 0.5))}:borderw=0`;
  }
  if (/outline|outlined|stroke|描边|空心/u.test(value)) {
    return `borderw=${Math.max(2, Math.round(fontSize * 0.045))}:bordercolor=black@0.9`;
  }
  return 'borderw=2:bordercolor=black@0.78';
}

function canUseCaptionWords(caption: string, words?: CanvasVideoEditorWord[]) {
  if (!words?.length || !caption.trim()) return false;
  const compact = (value: string) => value.replace(/\s+/gu, '');
  return compact(words.map((word) => word.text).join('')) === compact(caption);
}

type TextRenderOptions = {
  fontSize: number;
  backgroundOpacity?: number;
  textBox?: TextBox;
  x?: number;
  y?: number;
};

function normalizedTextBox(value?: TextBox) {
  if (!value) return undefined;
  const x = Math.max(0, Math.min(0.99, Number(value.x) || 0));
  const y = Math.max(0, Math.min(0.99, Number(value.y) || 0));
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, Number(value.width) || 0.01)),
    height: Math.max(0.01, Math.min(1 - y, Number(value.height) || 0.01)),
  };
}

function textLayoutForFfmpeg(text: string, options: TextRenderOptions, dimensions: { width: number; height: number }) {
  const textBox = normalizedTextBox(options.textBox);
  const maxWidth = textBox ? textBox.width * dimensions.width : dimensions.width * 0.82;
  const maxHeight = textBox ? textBox.height * dimensions.height : dimensions.height * 0.36;
  return { ...fitCanvasText({ text, fontSize: options.fontSize, maxWidth, maxHeight, minFontSize: 12 }), textBox, maxWidth, maxHeight };
}

function textFileContent(lines: string[]) {
  // drawtext treats a literal newline in textfile as a line break. Keeping
  // the trailing newline out makes the measured box match the preview.
  return lines.join('\n');
}

/**
 * Reproduce the editor's lightweight Ken Burns/pan cues in the server render.
 * The first scale/crop establishes the project frame; this second, animated
 * scale/crop moves that frame without changing the output dimensions.
 */
function motionFilter(shot: CloneShot, duration: number, dimensions: { width: number; height: number }, motionPath?: string) {
  const path = motionPath || shot.analysis?.motionPath || '';
  if (!path || path === 'none') return [];
  const progress = `min(1,max(0,t/${Math.max(0.05, duration).toFixed(3)}))`;
  const zoom = path === 'zoom-in' ? `(1+0.12*${progress})` : `(1.12-0.12*${progress})`;
  const x = path === 'pan-left'
    ? `(iw-ow)*${progress}`
    : path === 'pan-right'
      ? `(iw-ow)*(1-${progress})`
      : `(iw-ow)/2`;
  const y = path === 'pan-up'
    ? `(ih-oh)*${progress}`
    : path === 'pan-down'
      ? `(ih-oh)*(1-${progress})`
      : `(ih-oh)/2`;
  return [
    `scale=w='ceil(iw*${zoom}/2)*2':h='ceil(ih*${zoom}/2)*2':eval=frame`,
    `crop=${dimensions.width}:${dimensions.height}:x='${x}':y='${y}'`,
  ];
}

function escapeConcatPath(value: string) {
  return value.replaceAll("'", "'\\''");
}

function transitionFadeSeconds(shot: CloneShot, index: number) {
  if (index <= 0) return 0;
  const transition = String(shot.analysis?.transition || '').toLocaleLowerCase();
  return /fade|dissolve|cross|wipe|淡入|淡出|溶解|叠化|划入|转场/u.test(transition) ? 0.24 : 0;
}

function transitionName(shot: CloneShot, index: number, override?: CanvasVideoEditorTransition, direction?: CanvasVideoEditorClip['transitionDirection']) {
  if (index <= 0) return null;
  if (override === 'none' || override === 'cut') return null;
  if (override === 'fade' || override === 'dissolve') return override;
  if (override === 'wipe') {
    if (direction === 'right') return 'wiperight';
    if (direction === 'up') return 'wipeup';
    if (direction === 'down') return 'wipedown';
    return 'wipeleft';
  }
  if (override === 'slide') return direction === 'right' ? 'slideright' : 'slideleft';
  const structured = shot.analysis?.transitionType;
  if (structured === 'none' || structured === 'cut') return null;
  if (structured === 'fade' || structured === 'dissolve') return structured;
  if (structured === 'wipe' || structured === 'slide') {
    const transition = String(shot.analysis?.transition || '').toLocaleLowerCase();
    if (structured === 'slide') return /right|rightward|右方|右侧/u.test(transition) ? 'slideright' : 'slideleft';
    if (/right|rightward|右方|右侧/u.test(transition)) return 'wiperight';
    if (/up|upward|上方|上滑/u.test(transition)) return 'wipeup';
    if (/down|downward|下方|下滑/u.test(transition)) return 'wipedown';
    return 'wipeleft';
  }
  const transition = String(shot.analysis?.transition || '').toLocaleLowerCase();
  if (!/fade|dissolve|cross|wipe|slide|\u6de1\u5165|\u6de1\u51fa|\u6eb6\u89e3|\u53e0\u5316|\u5212\u5165|\u8f6c\u573a/u.test(transition)) return null;
  if (/wipe|\u5212\u5165/u.test(transition)) {
    if (/right|\u53f3\u65b9|\u53f3\u4fa7/u.test(transition)) return 'wiperight';
    if (/up|\u4e0a\u65b9|\u4e0a\u6ed1/u.test(transition)) return 'wipeup';
    if (/down|\u4e0b\u65b9|\u4e0b\u6ed1/u.test(transition)) return 'wipedown';
    return 'wipeleft';
  }
  if (/slide/u.test(transition)) return /right/u.test(transition) ? 'slideright' : 'slideleft';
  return /dissolve|cross|\u6eb6\u89e3|\u53e0\u5316/u.test(transition) ? 'dissolve' : 'fade';
}

function transitionSeconds(shot: CloneShot, index: number, fallback = 0, overrideDuration?: number, override?: CanvasVideoEditorTransition, direction?: CanvasVideoEditorClip['transitionDirection']) {
  if (!transitionName(shot, index, override, direction)) return 0;
  return Math.max(0, Number(overrideDuration) || Number(shot.analysis?.transitionDuration) || fallback || 0.24);
}

function findCaptionFont() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msyh.ttc'),
        path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'simhei.ttf'),
        path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'),
      ]
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Helvetica.ttc']
      : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function runFfmpeg(args: string[], timeoutMs = 15 * 60_000) {
  const { command, checked } = await resolveFfmpeg();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 进程已经退出 */ }
      finish(new Error('FFmpeg 合成超时，已停止处理'));
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
    child.once('error', (error: NodeJS.ErrnoException) => finish(new Error(`无法启动 FFmpeg：${error.code || error.message}；已检查：${checked.join('、')}`)));
    child.once('close', (code) => finish(code === 0 ? undefined : new Error(`视频合成失败${stderr.trim() ? `：${stderr.trim()}` : ''}`)));
  });
}

async function writeDownloadedSource(url: string, target: string) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`媒体下载失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error('媒体超过 512 MiB，无法合成');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength || buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('媒体为空或超过 512 MiB');
  await writeFile(target, buffer, { flag: 'wx' });
  return target;
}

async function resolveSource(url: string | undefined, kind: 'image' | 'video' | 'audio', input: AssemblyInput, index: number) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/u);
    if (!match) return null;
    const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    const file = path.join(input.workingDirectory, `source-${index}-${kind}${safeExtension(match[1] || '', kind === 'audio' ? '.wav' : kind === 'image' ? '.jpg' : '.mp4')}`);
    await writeFile(file, buffer, { flag: 'wx' });
    return file;
  }
  if (value.startsWith('/api/storage/file')) {
    const name = new URL(value, 'http://localhost').searchParams.get('name') || '';
    return resolveStoredFileWithFallback(input.imageStoragePath || '', name);
  }
  if (value.startsWith('/api/storage/video')) {
    const name = new URL(value, 'http://localhost').searchParams.get('name') || '';
    return resolveStoredVideoFileWithFallback(input.videoStoragePath || '', name);
  }
  if (value.startsWith('/api/storage/audio')) {
    const name = new URL(value, 'http://localhost').searchParams.get('name') || '';
    return resolveStoredAudioFileWithFallback(input.audioStoragePath || '', name);
  }
  if (!/^https?:\/\//iu.test(value)) return null;
  const file = path.join(input.workingDirectory, `source-${index}-${kind}${safeExtension(value, kind === 'audio' ? '.wav' : kind === 'image' ? '.jpg' : '.mp4')}`);
  return writeDownloadedSource(value, file);
}

async function resolveEventVisuals(input: AssemblyInput, shot: CloneShot, shotIndex: number, segmentStart: number, duration: number, workingDirectory: string) {
  const semanticEvents = input.timeline.tracks?.find((track) => track.kind === 'broll')?.clips
    .filter((clip) => clip.shotIndex === shotIndex && clip.duration > 0)
    .map((clip) => ({
      kind: 'broll' as const,
      start: Math.max(0, clip.start - segmentStart),
      end: Math.max(0, clip.start + clip.duration - segmentStart),
      ...(clip.url ? { url: clip.url } : {}),
      ...(clip.mediaKind === 'image' || clip.mediaKind === 'video' ? { mediaKind: clip.mediaKind } : {}),
      source: clip.source,
    })) || [];
  const events = semanticEvents.length
    ? semanticEvents
    : shot.analysis?.events?.filter((event) => event.kind === 'broll' && event.end > event.start) || [];
  const result: EventVisual[] = [];
  for (const [eventIndex, event] of events.entries()) {
    const start = Math.max(0, Math.min(duration, event.start));
    const end = Math.max(start, Math.min(duration, event.end));
    if (end <= start) continue;
    if (event.url) {
      const inferredKind = event.mediaKind || (/^data:image\//iu.test(event.url) || /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/iu.test(event.url) ? 'image' : 'video');
      const file = await resolveSource(event.url, inferredKind, input, shotIndex * 100 + eventIndex);
      if (file) result.push({ file, isVideo: event.mediaKind !== 'image', start, end, sourceOffset: 0 });
      continue;
    }
    if (input.referenceFile && event.source !== 'generated-media') {
      const output = path.join(workingDirectory, `broll-reference-${String(shotIndex).padStart(3, '0')}-${String(eventIndex).padStart(3, '0')}.mp4`);
      try {
        await extractVideoSegment(input.referenceFile, shot.start + event.start, shot.start + event.end, output);
        result.push({ file: output, isVideo: true, start, end, sourceOffset: 0 });
      } catch {
        // Event metadata remains in the persisted timeline even if this optional visual cannot be materialized.
      }
    }
  }
  return result;
}

async function resolveShotSources(shot: CloneShot, index: number, input: AssemblyInput, preferredVideoClip?: CanvasVideoEditorClip): Promise<ResolvedSources> {
  const videoClip = timelineVideoClip(input, shot, index, preferredVideoClip);
  // The flattened timeline is also assembled without editorState. In that
  // mode the semantic clip's output start is still needed for voice and
  // reference-audio offsets; defaulting it to zero makes every later shot
  // read the beginning of the source track again.
  const timelineVideo = timelineTrack(input, 'video')?.clips.find((clip) => clip.shotIndex === index);
  const start = preferredVideoClip?.start ?? timelineVideo?.start ?? 0;
  const duration = Math.max(0.1, Number(videoClip.duration) || (shot.end - shot.start));
  const referenceVisual = shot.preserveReferenceFrame && input.referenceFile
    ? await extractVideoSegment(
      input.referenceFile,
      Number(videoClip.sourceOffset ?? shot.start),
      Number(videoClip.sourceOffset ?? shot.start) + duration * (videoClip.playbackRate || 1),
      path.join(input.workingDirectory, `reference-visual-${String(index).padStart(3, '0')}.mp4`),
    ).then(async (file) => {
      const seconds = await probeMediaSeconds(file).catch(() => null);
      return seconds && seconds > 0.05 ? file : null;
    }).catch(() => null)
    : null;
  // A damaged or temporarily unavailable source segment must not turn a
  // reference-preserved shot into a black frame. The representative frame is
  // already persisted during analysis, so use it as the deterministic local
  // fallback before the final black placeholder.
  const referenceFrame = shot.preserveReferenceFrame && shot.referenceFrameUrl
    ? await resolveSource(shot.referenceFrameUrl, 'image', input, index)
    : null;
  const voice = timelineAudioClip(input, shot, index, start, duration);
  const visualPromise = (async () => {
    if (!videoClip.enabled) return null;
    if (referenceVisual) return referenceVisual;
    const generated = await resolveSource(videoClip.url, shot.videoUrl ? 'video' : 'image', input, index);
    return generated || referenceFrame;
  })();
  const [visual, audio, ambient] = await Promise.all([
    visualPromise,
    resolveSource(voice?.url, 'audio', input, index),
    resolveReferenceAmbient(input, shot, index, start, duration),
  ]);
  return {
    visual,
    visualIsVideo: Boolean(referenceVisual || (shot.videoUrl && videoClip.enabled)),
    referenceFrameFallback: Boolean(shot.preserveReferenceFrame && input.referenceFile && !referenceVisual && referenceFrame),
    visualOffset: referenceVisual ? 0 : Math.max(0, Number(videoClip.sourceOffset) || 0),
    visualRate: videoClip.playbackRate || 1,
    visualFit: videoClip.fit || 'cover',
    visualScale: videoClip.scale || 1,
    visualX: videoClip.x || 0,
    visualY: videoClip.y || 0,
    visualOpacity: videoClip.opacity ?? 1,
    audio,
    audioOffset: voice?.sourceOffset ?? 0,
    audioVolume: voice?.volume ?? 1,
    audioRate: voice?.rate || 1,
    ambient: ambient?.file || null,
    ambientVolume: ambient?.volume ?? 0.35,
    ambientRate: ambient?.rate || 1,
    duckAmbient: input.timeline.editorState?.referenceAudioDucking === true,
  };
}

async function extractAudioSegment(input: string, start: number, end: number, outputDuration: number, workingDirectory: string, index: number) {
  const output = path.join(workingDirectory, `reference-audio-materialized-${String(index).padStart(3, '0')}.m4a`);
  const sourceDuration = Math.max(0.1, (Number(end) || 0) - (Number(start) || 0));
  const targetDuration = Math.max(0.1, Number(outputDuration) || sourceDuration);
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', Math.max(0, Number(start) || 0).toFixed(3),
    '-i', input,
    '-t', sourceDuration.toFixed(3),
    '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    // A rewritten narration can make a shot longer than its source interval.
    // Pad the ambience before the output -t cap so the A2 track remains
    // present for the complete authored shot instead of ending early.
    '-af', `apad=pad_dur=${targetDuration.toFixed(3)}`,
    '-t', targetDuration.toFixed(3),
    '-movflags', '+faststart', output,
  ], 120_000);
  return result.code === 0 && existsSync(output) ? output : null;
}

async function resolveReferenceAmbient(input: AssemblyInput, shot: CloneShot, index: number, start: number, duration: number) {
  const edited = editorClipForSegment(input, 'reference-audio', index, start, duration);
  if (input.timeline.editorState && !edited) return null;
  const referenceTrack = timelineTrack(input, 'reference-audio');
  const editedSourceClipId = edited && 'sourceClipId' in edited ? edited.sourceClipId : undefined;
  const base = referenceTrack?.clips.find((item) => item.id === editedSourceClipId)
    || referenceTrack?.clips
      .filter((item) => item.start < start + duration && item.start + item.duration > start)
      .sort((left, right) => right.start - left.start)[0]
    || null;
  const clip = edited ? { ...base, ...edited, ...(base?.url ? { url: base.url } : {}) } : base;
  if (!editorTrackAudioEnabled(input, 'reference-audio')) return null;
  if (clip?.enabled === false || input.job.options.preserveReferenceAudio === false) return null;
  if (clip?.url) {
    const source = await resolveSource(clip.url, 'audio', input, index);
    if (source) {
      // The normal plan now stores one global A2 clip. Its semantic source
      // clock is still the reference video's clock, while `start` is the
      // output timeline clock. When narration has extended an earlier shot,
      // those clocks diverge; use this shot's recovered reference start so
      // later ambience does not drift into the wrong source interval.
      const clipSourceClipId = 'sourceClipId' in clip ? clip.sourceClipId : undefined;
      const isGlobalReferenceTrack = base?.id === 'clone-reference-audio-global'
        || clip.id === 'clone-reference-audio-global'
        || clipSourceClipId === 'clone-reference-audio-global';
      const sourceStart = isGlobalReferenceTrack
        ? Math.max(0, Number(shot.start) || 0)
        : (clip.sourceOffset ?? shot.start) + Math.max(0, start - clip.start) * (clip.playbackRate || 1);
      const referenceDuration = Math.max(0.1, (Number(shot.end) || 0) - (Number(shot.start) || 0));
      const playbackRate = clip.playbackRate || 1;
      const sourceDuration = isGlobalReferenceTrack
        ? Math.min(referenceDuration, duration) * playbackRate
        : duration * playbackRate;
      const file = await extractAudioSegment(source, sourceStart, sourceStart + sourceDuration, duration, input.workingDirectory, index);
      return file ? { file, volume: normalizedClipVolume(clip.volume, 0.35), rate: clip.playbackRate || 1 } : null;
    }
  }
  const file = input.referenceFile
    ? await extractReferenceAudio(input.referenceFile, shot.start, shot.end, input.workingDirectory, index)
    : null;
  return file ? { file, volume: 0.35, rate: 1 } : null;
}

async function extractReferenceAudio(referenceFile: string, start: number, end: number, workingDirectory: string, index: number) {
  const output = path.join(workingDirectory, `reference-audio-${String(index).padStart(3, '0')}.m4a`);
  const duration = Math.max(0.1, (Number(end) || 0) - (Number(start) || 0));
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', Math.max(0, Number(start) || 0).toFixed(3),
    '-i', referenceFile,
    '-t', duration.toFixed(3),
    '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-af', `apad=pad_dur=${duration.toFixed(3)}`,
    '-movflags', '+faststart', output,
  ], 120_000);
  return result.code === 0 && existsSync(output) ? output : null;
}

async function renderSegment(
  shot: CloneShot,
  index: number,
  duration: number,
  caption: string,
  captionWords: CanvasVideoEditorWord[] | undefined,
  graphics: string,
  graphicsStyle: string | undefined,
  graphicsBounds: TextBox | undefined,
  captionOptions: TextRenderOptions | undefined,
  graphicsOptions: TextRenderOptions | undefined,
  layout: CanvasVideoEditorLayout | undefined,
  motionPath: string | undefined,
  sources: ResolvedSources,
  input: AssemblyInput,
  dimensions: { width: number; height: number },
  font: string | null,
  overlays: RenderOverlay[] = [],
  eventVisuals: EventVisual[] = [],
) {
  const fps = Math.max(1, input.timeline.fps || 30);
  const output = path.join(input.workingDirectory, `segment-${String(index).padStart(3, '0')}.mp4`);
  const captionFile = path.join(input.workingDirectory, `caption-${String(index).padStart(3, '0')}.txt`);
  const graphicsFile = path.join(input.workingDirectory, `graphics-${String(index).padStart(3, '0')}.txt`);
  const hasCaption = Boolean(caption.trim() && font);
  const hasGraphics = Boolean(graphics.trim() && font);
  const captionLayout = hasCaption
    ? textLayoutForFfmpeg(caption.trim(), { fontSize: captionOptions?.fontSize || 48, ...captionOptions }, dimensions)
    : null;
  const graphicsLayout = hasGraphics
    ? textLayoutForFfmpeg(graphics.trim(), { fontSize: graphicsOptions?.fontSize || 48, textBox: graphicsBounds, ...graphicsOptions }, dimensions)
    : null;
  const timedCaptionWords = hasCaption && canUseCaptionWords(caption, captionWords)
    ? captionWords
      ?.map((word) => ({ ...word, start: Math.max(0, Math.min(duration, word.start)), end: Math.max(0, Math.min(duration, word.end)) }))
      .filter((word) => word.end > word.start && word.text.trim())
    : undefined;
  if (hasCaption && !timedCaptionWords?.length) await writeFile(captionFile, textFileContent(captionLayout?.lines || [caption.trim()]), { encoding: 'utf8', flag: 'wx' });
  if (hasGraphics) await writeFile(graphicsFile, textFileContent(graphicsLayout?.lines || [graphics.trim()]), { encoding: 'utf8', flag: 'wx' });
  const region = layoutRegion(layout, dimensions);
  const secondaryRegion = layoutRegion(layout, dimensions, true);
  const hasMotion = Boolean(motionPath && motionPath !== 'none' && !region);
  const filterParts = (target: { width: number; height: number } | null) => [
    `scale=${target?.width || dimensions.width}:${target?.height || dimensions.height}:force_original_aspect_ratio=${sources.visualFit === 'contain' ? 'decrease' : 'increase'}`,
    'setsar=1',
    `fps=${fps}`,
  ];
  const textFilterParts: string[] = [];
  const renderVisual = (inputLabel: string, outputLabel: string, target: { width: number; height: number } | null, animate: boolean) => {
    const filters = filterParts(target);
    if (sources.visualIsVideo) {
      if (sources.visualRate !== 1) filters.push(`setpts=PTS/${sources.visualRate}`);
      filters.push(`tpad=stop_mode=clone:stop_duration=${duration.toFixed(3)}`);
    }
    if (animate) filters.push(...motionFilter(shot, duration, dimensions, motionPath));
    const outputWidth = target?.width || dimensions.width;
    const outputHeight = target?.height || dimensions.height;
    if (sources.visualScale !== 1 || sources.visualX !== 0 || sources.visualY !== 0 || sources.visualOpacity !== 1) {
      filters.push(`scale=w='ceil(iw*${sources.visualScale.toFixed(3)}/2)*2':h='ceil(ih*${sources.visualScale.toFixed(3)}/2)*2':eval=frame`);
    }
    if (sources.visualFit === 'contain') {
      filters.push(`pad=${outputWidth}:${outputHeight}:x='(ow-iw)/2+${(sources.visualX * outputWidth / 2).toFixed(1)}':y='(oh-ih)/2+${(sources.visualY * outputHeight / 2).toFixed(1)}':color=${safeFilterColor(layout?.backgroundColor, '#000')}`);
    } else {
      filters.push(`crop=${outputWidth}:${outputHeight}:x='(iw-ow)/2-${(sources.visualX * outputWidth / 2).toFixed(1)}':y='(ih-oh)/2-${(sources.visualY * outputHeight / 2).toFixed(1)}'`);
    }
    if (sources.visualOpacity !== 1) filters.push(`colorchannelmixer=aa=${sources.visualOpacity.toFixed(3)}`);
    return `[${inputLabel}]${filters.join(',')}[${outputLabel}]`;
  };
  if (hasCaption) {
    // FFmpeg on Windows treats an unquoted `C\:/...` textfile value as a
    // second drawtext option and fails with "Both text and text file".
    const placement = captionPlacement(shot.analysis?.graphicsPosition);
    const captionFontSize = captionLayout?.fontSize || captionOptions?.fontSize || 48;
    const captionBoxOpacity = Math.max(0, Math.min(1, captionOptions?.backgroundOpacity ?? 0.68));
    const captionX = captionOptions?.x !== undefined
      ? `(w-text_w)/2+${(captionOptions.x * dimensions.width / 2).toFixed(1)}`
      : placement.x;
    const captionY = captionOptions?.y !== undefined
      ? `(h*(0.83-${captionOptions.y.toFixed(3)}*0.45)-text_h/2)`
      : '(h*0.83-text_h/2)';
    if (timedCaptionWords?.length) {
      for (let wordIndex = 0; wordIndex < timedCaptionWords.length; wordIndex += 1) {
        const word = timedCaptionWords[wordIndex];
        const wordFile = path.join(input.workingDirectory, `caption-${String(index).padStart(3, '0')}-${String(wordIndex).padStart(3, '0')}.txt`);
        const visibleText = timedCaptionWords.slice(0, wordIndex + 1).map((item) => item.text).join('');
        const wordLayout = textLayoutForFfmpeg(visibleText, { fontSize: captionFontSize, ...captionOptions }, dimensions);
        await writeFile(wordFile, textFileContent(wordLayout.lines), { encoding: 'utf8', flag: 'wx' });
        const nextStart = timedCaptionWords[wordIndex + 1]?.start ?? duration;
        const enable = `between(t\\,${word.start.toFixed(3)}\\,${Math.max(word.start, nextStart).toFixed(3)})`;
        textFilterParts.push(`drawtext=fontfile='${escapeFilterPath(font as string)}':textfile='${escapeFilterPath(wordFile)}':fontcolor=white:fontsize=${captionFontSize}:line_spacing=${Math.round(captionFontSize * 0.35)}:borderw=2:bordercolor=black@0.85:box=1:boxcolor=black@${captionBoxOpacity.toFixed(2)}:boxborderw=${Math.max(4, Math.round(captionFontSize * 0.38))}:x=${captionX}:y=${captionY}:enable='${enable}'`);
      }
    } else {
      textFilterParts.push(`drawtext=fontfile='${escapeFilterPath(font as string)}':textfile='${escapeFilterPath(captionFile)}':fontcolor=white:fontsize=${captionFontSize}:line_spacing=${Math.round(captionFontSize * 0.35)}:borderw=2:bordercolor=black@0.85:box=1:boxcolor=black@${captionBoxOpacity.toFixed(2)}:boxborderw=${Math.max(4, Math.round(captionFontSize * 0.38))}:x=${captionX}:y=${captionY}`);
    }
  }
  if (hasGraphics) {
    const placement = graphicsLayout?.textBox
      ? {
        x: `(${((graphicsLayout.textBox.x + graphicsLayout.textBox.width / 2) * dimensions.width).toFixed(1)}-text_w/2)`,
        y: `(${((graphicsLayout.textBox.y + graphicsLayout.textBox.height / 2) * dimensions.height).toFixed(1)}-text_h/2)`,
        fontsize: graphicsLayout.fontSize,
      }
      : {
        x: graphicsOptions?.x !== undefined
          ? `(w-text_w)/2+${(graphicsOptions.x * dimensions.width / 2).toFixed(1)}`
          : captionPlacement(shot.analysis?.graphicsPosition).x,
        y: graphicsOptions?.y !== undefined
          ? `(h*0.83-text_h/2)-${(graphicsOptions.y * dimensions.height * 0.45).toFixed(1)}`
          : captionPlacement(shot.analysis?.graphicsPosition).y,
        fontsize: graphicsLayout?.fontSize || graphicsOptions?.fontSize || 60,
      };
    const enable = overlays.length ? `:enable='${overlays.map((item) => `between(t\\,${item.start.toFixed(3)}\\,${item.end.toFixed(3)})`).join('+')}'` : '';
    textFilterParts.push(`drawtext=fontfile='${escapeFilterPath(font as string)}':textfile='${escapeFilterPath(graphicsFile)}':fontcolor=white:fontsize=${placement.fontsize}:line_spacing=${Math.round(placement.fontsize * 0.35)}:${graphicsDrawTextOptions(graphicsStyle, graphicsOptions?.backgroundOpacity, placement.fontsize)}:x=${placement.x}:y=${placement.y}${enable}`);
  }
  if (font) {
    for (const [overlayIndex, overlay] of overlays.entries()) {
      const overlayFile = path.join(input.workingDirectory, `event-graphics-${String(index).padStart(3, '0')}-${String(overlayIndex).padStart(3, '0')}.txt`);
      const overlayLayout = textLayoutForFfmpeg(overlay.text, { fontSize: overlay.options?.fontSize || 48, textBox: overlay.bounds, ...overlay.options }, dimensions);
      await writeFile(overlayFile, textFileContent(overlayLayout.lines || [overlay.text]), { encoding: 'utf8', flag: 'wx' });
      const overlayPlacement = overlayLayout.textBox
        ? {
          x: `(${((overlayLayout.textBox.x + overlayLayout.textBox.width / 2) * dimensions.width).toFixed(1)}-text_w/2)`,
          y: `(${((overlayLayout.textBox.y + overlayLayout.textBox.height / 2) * dimensions.height).toFixed(1)}-text_h/2)`,
        }
        : {
          x: overlay.options?.x !== undefined
            ? `(w-text_w)/2+${(overlay.options.x * dimensions.width / 2).toFixed(1)}`
            : captionPlacement(overlay.position).x,
          y: overlay.options?.y !== undefined
            ? `(h*0.83-text_h/2)-${(overlay.options.y * dimensions.height * 0.45).toFixed(1)}`
            : captionPlacement(overlay.position).y,
        };
      textFilterParts.push(`drawtext=fontfile='${escapeFilterPath(font)}':textfile='${escapeFilterPath(overlayFile)}':fontcolor=white:fontsize=${overlayLayout.fontSize}:line_spacing=${Math.round(overlayLayout.fontSize * 0.35)}:${graphicsDrawTextOptions(overlay.style, overlay.options?.backgroundOpacity, overlayLayout.fontSize)}:x=${overlayPlacement.x}:y=${overlayPlacement.y}:enable='between(t\\,${overlay.start.toFixed(3)}\\,${overlay.end.toFixed(3)})'`);
    }
  }
  const visualInput = sources.visual
    ? (sources.visualIsVideo ? ['-ss', sources.visualOffset.toFixed(3), '-i', sources.visual] : ['-loop', '1', '-framerate', String(fps), '-i', sources.visual])
    : ['-f', 'lavfi', '-i', `color=c=black:s=${dimensions.width}x${dimensions.height}:r=${fps}`];
  const eventInputs = eventVisuals.flatMap((event) => event.isVideo
    ? ['-ss', event.sourceOffset.toFixed(3), '-i', event.file]
    : ['-loop', '1', '-framerate', String(fps), '-i', event.file]);
  const audioInputs: string[] = [];
  if (sources.audio) audioInputs.push('-ss', sources.audioOffset.toFixed(3), '-i', sources.audio);
  if (sources.ambient) audioInputs.push('-i', sources.ambient);
  if (!sources.audio && !sources.ambient) audioInputs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  const eventInputStart = 1;
  const audioInputStart = eventInputStart + eventVisuals.length;
  const voiceIndex = sources.audio ? audioInputStart : -1;
  const ambientIndex = sources.ambient ? (audioInputStart + (sources.audio ? 1 : 0)) : -1;
  const silentAudioIndex = audioInputStart;
  const textFilters = textFilterParts.length ? `,${textFilterParts.join(',')}` : '';
  const eventFilterParts: string[] = [];
  let eventBase = '[shot]';
  eventVisuals.forEach((event, eventIndex) => {
    const eventInputIndex = eventInputStart + eventIndex;
    const eventDuration = Math.max(0.05, event.end - event.start);
    const eventLabel = `[event-${eventIndex}]`;
    eventFilterParts.push(`[${eventInputIndex}:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase,crop=${dimensions.width}:${dimensions.height},setsar=1,fps=${fps},trim=duration=${eventDuration.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${Math.max(0, duration - eventDuration).toFixed(3)}${eventLabel}`);
    const nextBase = `[event-base-${eventIndex}]`;
    eventFilterParts.push(`${eventBase}${eventLabel}overlay=0:0:enable='between(t\\,${event.start.toFixed(3)}\\,${event.end.toFixed(3)})':eof_action=pass${nextBase}`);
    eventBase = nextBase;
  });
  const compositePrefix = eventFilterParts.length ? `${eventFilterParts.join(';')};${eventBase}` : '[shot]';
  const videoFilter = region || secondaryRegion
    ? (() => {
      const laid = `${secondaryRegion ? '[0:v]split=2[primaryInput][secondaryInput];' : ''}${renderVisual(secondaryRegion ? 'primaryInput' : '0:v', 'shot', region, hasMotion)}${secondaryRegion ? `;${renderVisual('secondaryInput', 'secondaryShot', secondaryRegion, false)}` : ''};color=c=${safeFilterColor(layout?.backgroundColor, '#000')}:s=${dimensions.width}x${dimensions.height}:r=${fps}:d=${duration.toFixed(3)}[base];[base][shot]overlay=${region?.x || 0}:${region?.y || 0}:shortest=1[laid]${secondaryRegion ? `;[laid][secondaryShot]overlay=${secondaryRegion.x}:${secondaryRegion.y}:shortest=1[laid2]` : ''}`;
      const composited = eventFilterParts.length
        ? `${eventFilterParts.map((part) => part.replace('[shot]', secondaryRegion ? '[laid2]' : '[laid]')).join(';')};${eventBase}`
        : secondaryRegion ? '[laid2]' : '[laid]';
      return `${laid};${composited}format=yuv420p${textFilters}[vout]`;
    })()
    : `${renderVisual('0:v', 'shot', null, hasMotion)};${compositePrefix}format=yuv420p${textFilters}[vout]`;
  const audioFilter = sources.audio && sources.ambient
    ? sources.duckAmbient
      ? `[${voiceIndex}:a]volume=${sources.audioVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.audioRate)}[voice];[${voiceIndex}:a]volume=${sources.audioVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.audioRate)}[voice_sidechain];[${ambientIndex}:a]volume=${sources.ambientVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.ambientRate)}[amb];[amb][voice_sidechain]sidechaincompress=threshold=0.035:ratio=8:attack=15:release=280:makeup=1[ducked_amb];[voice][ducked_amb]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]`
      : `[${voiceIndex}:a]volume=${sources.audioVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.audioRate)}[voice];[${ambientIndex}:a]volume=${sources.ambientVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.ambientRate)}[amb];[voice][amb]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]`
    : sources.audio
      ? `[${voiceIndex}:a]volume=${sources.audioVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.audioRate)}[aout]`
      : sources.ambient
        ? `[${ambientIndex}:a]volume=${sources.ambientVolume.toFixed(3)},aresample=48000${audioTempoFilters(sources.ambientRate)}[aout]`
        : `[${silentAudioIndex}:a]anull[aout]`;
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    ...visualInput,
    ...eventInputs,
    ...audioInputs,
    '-filter_complex', `${videoFilter};${audioFilter}`,
    '-map', '[vout]', '-map', '[aout]',
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-t', duration.toFixed(3),
    '-movflags', '+faststart', output,
  ]);
  return output;
}

type RenderedSegment = {
  file: string;
  duration: number;
  shot: CloneShot;
  transitionIn?: CanvasVideoEditorTransition;
  transitionDuration?: number;
  transitionDirection?: CanvasVideoEditorClip['transitionDirection'];
};

/** Apply the reference edit's transition relationship after each shot is normalized. */
async function assembleRenderedSegments(segments: RenderedSegment[], outputFile: string) {
  if (segments.length === 1) {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', segments[0].file, '-c', 'copy', '-movflags', '+faststart', outputFile]);
    return;
  }
  const hasTransition = segments.slice(1).some((segment, index) => Boolean(transitionName(segment.shot, index + 1, segment.transitionIn, segment.transitionDirection)));
  if (!hasTransition) {
    const listFile = `${outputFile}.concat.txt`;
    await writeFile(listFile, segments.map((segment) => `file '${escapeConcatPath(segment.file)}'`).join('\n'), { encoding: 'utf8', flag: 'wx' });
    try {
      await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outputFile]);
    } finally {
      await rm(listFile, { force: true }).catch(() => undefined);
    }
    return;
  }
  const graph: string[] = [];
  const inputs = segments.flatMap((segment) => ['-i', segment.file]);
  segments.forEach((_, index) => {
    graph.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    graph.push(`[${index}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`);
  });
  let video = '[v0]';
  let audio = '[a0]';
  let currentDuration = Math.max(0.1, segments[0].duration);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const transition = transitionName(segment.shot, index, segment.transitionIn, segment.transitionDirection) || 'fade';
    const requested = transitionSeconds(segment.shot, index, 0.24, segment.transitionDuration, segment.transitionIn, segment.transitionDirection);
    const duration = Math.max(0.001, Math.min(requested || 0.001, currentDuration - 0.001, segments[index].duration - 0.001));
    const offset = Math.max(0, currentDuration - duration);
    const nextVideo = `[vx${index}]`;
    const nextAudio = `[ax${index}]`;
    graph.push(`${video}[v${index}]xfade=transition=${transition}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${nextVideo}`);
    graph.push(`${audio}[a${index}]acrossfade=d=${duration.toFixed(3)}:c1=tri:c2=tri${nextAudio}`);
    video = nextVideo;
    audio = nextAudio;
    currentDuration = currentDuration + segments[index].duration - duration;
  }
  const targetDuration = segments.reduce((total, segment) => total + segment.duration, 0);
  const padding = Math.max(0, targetDuration - currentDuration);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', `${graph.join(';')};${video}format=yuv420p,tpad=stop_mode=clone:stop_duration=${padding.toFixed(3)}[vout];${audio}apad=pad_dur=${padding.toFixed(3)},atrim=duration=${targetDuration.toFixed(3)}[aout]`,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-t', targetDuration.toFixed(3), '-movflags', '+faststart', outputFile,
  ]);
}

export async function assembleCloneVideo(input: AssemblyInput) {
  const dimensions = projectDimensions(input.timeline.editorState?.aspect || input.job.options.aspect, input.timeline.editorState?.resolution);
  const font = findCaptionFont();
  const warnings: string[] = [];
  if (!font && input.timeline.clips.some((clip) => (clip.track === 'caption' || clip.track === 'graphics') && clip.text?.trim())) warnings.push('本机没有可用中文字体，成片暂未烧录字幕/画面字卡');
  await mkdir(input.workingDirectory, { recursive: true });
  try {
    const segments: RenderedSegment[] = [];
    const renderQueue = input.timeline.editorState
      ? input.timeline.editorState.clips
        // Keep disabled video clips in the queue so disabling V1 produces a
        // black video lane while audio/captions retain their authored timing.
        .filter((clip) => clip.track === 'video')
        .sort((a, b) => a.start - b.start)
        .map((clip) => ({ clip, shotIndex: shotIndexForClip(clip, -1) }))
        .filter(({ shotIndex }) => shotIndex >= 0 && Boolean(input.job.shots[shotIndex]))
      : input.job.shots.map((shot, index) => ({ clip: input.timeline.clips.find((clip) => clip.id === `clone-video-${index}`), shotIndex: index })).filter(({ clip }) => Boolean(clip));
    for (const [renderIndex, item] of renderQueue.entries()) {
      const shot = input.job.shots[item.shotIndex];
      const index = item.shotIndex;
      const videoClip = item.clip as CanvasVideoEditorClip;
      const componentId = videoClip.componentId || componentForShot(input, index);
      const component = componentId ? input.timeline.components?.find((candidate) => candidate.id === componentId) : undefined;
      const captionClip = input.timeline.clips.find((clip) => clip.id === `clone-caption-${item.shotIndex}`);
      const sources = await resolveShotSources(shot, item.shotIndex, input, input.timeline.editorState ? videoClip : undefined);
      if (!sources.visual) warnings.push(`第 ${index + 1} 个镜头缺少画面，已用黑场占位`);
      if (shot.audioUrl && !sources.audio) warnings.push(`第 ${index + 1} 个镜头配音读取失败，已改用参考音频或静音`);
      if (input.job.options.preserveReferenceAudio !== false && input.referenceFile && !sources.ambient) warnings.push(`第 ${index + 1} 个镜头未读取到原片音频，已使用新配音或静音`);
      if (sources.referenceFrameFallback) warnings.push('\u53c2\u8003\u955c\u5934\u7684\u539f\u7247\u7247\u6bb5\u65e0\u6cd5\u8bfb\u53d6\uff0c\u5df2\u56de\u9000\u5230\u4ee3\u8868\u6027\u53c2\u8003\u5e27');
      const duration = Math.max(0.1, videoClip.duration);
      const semanticCaption = input.timeline.editorState
        ? editorOverlayForSegment(input, 'caption', videoClip.start, duration)
        : timelineTrack(input, 'caption')
          ? timelineTrackClip(input, 'caption', item.shotIndex)
          : null;
      const semanticGraphics = input.timeline.editorState
        ? editorOverlayForSegment(input, 'graphics', videoClip.start, duration)
          : timelineTrack(input, 'graphics')
            ? timelineTrackClip(input, 'graphics', item.shotIndex)
            : null;
      const eventGraphics = graphicsClipsForSegment(input, item.shotIndex, videoClip.start, duration);
      const caption = shot.preserveReferenceFrame && !shot.allowReferenceOverlays || (semanticCaption && 'enabled' in semanticCaption && semanticCaption.enabled === false)
        ? ''
        : input.timeline.editorState
          ? semanticCaption?.text || ''
          : semanticCaption?.text || captionClip?.text || '';
      const captionWords = shot.preserveReferenceFrame && !shot.allowReferenceOverlays || (semanticCaption && 'enabled' in semanticCaption && semanticCaption.enabled === false)
        ? undefined
        : input.timeline.editorState
          ? semanticCaption?.words
          : semanticCaption?.words || captionClip?.words;
      const graphics = shot.preserveReferenceFrame && !shot.allowReferenceOverlays || (semanticGraphics && 'enabled' in semanticGraphics && semanticGraphics.enabled === false)
        ? ''
        : eventGraphics.some((clip) => Boolean(clip.text?.trim()))
          ? ''
          : semanticGraphics?.text || '';
      const numericClipOption = (clip: unknown, key: string, fallback: number) => {
        if (!clip || typeof clip !== 'object') return fallback;
        const value = (clip as Record<string, unknown>)[key];
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
      };
      const optionalClipNumber = (clip: unknown, key: string) => {
        if (!clip || typeof clip !== 'object') return undefined;
        const value = Number((clip as Record<string, unknown>)[key]);
        return Number.isFinite(value) ? value : undefined;
      };
      const captionSource = input.timeline.editorState ? semanticCaption : captionClip || semanticCaption;
      const captionOptions: TextRenderOptions | undefined = caption
        ? {
          fontSize: numericClipOption(captionSource, 'fontSize', 42),
          backgroundOpacity: numericClipOption(captionSource, 'captionBackgroundOpacity', 0.68),
          ...(optionalClipNumber(captionSource, 'x') !== undefined ? { x: optionalClipNumber(captionSource, 'x') } : {}),
          ...(optionalClipNumber(captionSource, 'y') !== undefined ? { y: optionalClipNumber(captionSource, 'y') } : {}),
        }
        : undefined;
      const graphicsSource = input.timeline.editorState ? semanticGraphics : input.timeline.clips.find((clip) => clip.id === `clone-graphics-${item.shotIndex}`) || semanticGraphics;
      const effectiveGraphicsStyle = semanticGraphics?.graphicsStyle || component?.graphicsStyle || shot.analysis?.graphicsStyle;
      const effectiveGraphicsBox = semanticGraphics && 'textBox' in semanticGraphics
        ? videoEditorTextBox(semanticGraphics)
        : undefined;
      const graphicsOptions: TextRenderOptions | undefined = graphics
        ? {
          fontSize: numericClipOption(graphicsSource, 'fontSize', 48),
          backgroundOpacity: optionalClipNumber(graphicsSource, 'captionBackgroundOpacity') ?? (/card|box|solid|label|tag|banner|色块|卡片|标签|底板/iu.test(String(effectiveGraphicsStyle || '')) ? 0.72 : 0),
          ...(effectiveGraphicsBox ? { textBox: effectiveGraphicsBox } : {}),
          ...(optionalClipNumber(graphicsSource, 'x') !== undefined ? { x: optionalClipNumber(graphicsSource, 'x') } : {}),
          ...(optionalClipNumber(graphicsSource, 'y') !== undefined ? { y: optionalClipNumber(graphicsSource, 'y') } : {}),
        }
        : undefined;
      const eventOverlays: RenderOverlay[] = shot.preserveReferenceFrame && !shot.allowReferenceOverlays
        ? []
        : eventGraphics.flatMap((clip) => {
          if (!clip.text?.trim() || ('enabled' in clip && clip.enabled === false)) return [];
          const clipStart = Number(clip.start) || 0;
          const clipEnd = clipStart + Math.max(0, Number(clip.duration) || 0);
          const localStart = Math.max(0, clipStart - videoClip.start);
          const localEnd = Math.min(duration, clipEnd - videoClip.start);
          if (localEnd <= localStart) return [];
          const textBox = 'textBox' in clip ? videoEditorTextBox(clip) : undefined;
          const style = 'graphicsStyle' in clip ? clip.graphicsStyle : undefined;
          return [{
            text: clip.text.trim(),
            start: localStart,
            end: localEnd,
            ...(style ? { style } : {}),
            ...('position' in clip && typeof clip.position === 'string' && clip.position ? { position: clip.position } : {}),
            ...(textBox ? { bounds: textBox } : {}),
            options: {
              fontSize: numericClipOption(clip, 'fontSize', 48),
              backgroundOpacity: optionalClipNumber(clip, 'captionBackgroundOpacity') ?? (/card|box|solid|label|tag|banner|卡片|色块|标签|底板/iu.test(String(style || '')) ? 0.72 : 0),
              ...(optionalClipNumber(clip, 'x') !== undefined ? { x: optionalClipNumber(clip, 'x') } : {}),
              ...(optionalClipNumber(clip, 'y') !== undefined ? { y: optionalClipNumber(clip, 'y') } : {}),
            },
          }];
        });
      const eventVisuals = await resolveEventVisuals(input, shot, index, videoClip.start, duration, input.workingDirectory);
      const renderLayout = input.timeline.editorState
        ? videoClip.layout || component?.layout || (shot.preserveReferenceFrame ? undefined : shot.analysis?.layout)
        : sources.visualIsVideo && shot.preserveReferenceFrame ? undefined : videoClip.layout || component?.layout || shot.analysis?.layout;
      const renderMotionPath = videoClip.motionPath || component?.motionPath;
      segments.push({
        file: await renderSegment(shot, renderIndex, duration, caption, captionWords, graphics, effectiveGraphicsStyle, effectiveGraphicsBox || shot.analysis?.graphicsBounds, captionOptions, graphicsOptions, renderLayout, renderMotionPath, sources, input, dimensions, font, eventOverlays, eventVisuals),
        duration,
        shot,
        transitionIn: videoClip.transitionIn,
        transitionDuration: videoClip.transitionDuration,
        transitionDirection: videoClip.transitionDirection,
      });
      await input.onProgress?.((renderIndex + 1) / Math.max(1, renderQueue.length));
    }
    if (!segments.length) throw new Error('没有可合成的镜头素材');
    const outputFile = path.join(input.workingDirectory, 'final.mp4');
    await assembleRenderedSegments(segments, outputFile);
    const buffer = await readFile(outputFile);
    const stored = await persistVideoBuffer(buffer, 'video/mp4');
    return { url: stored.url, mime: 'video/mp4', width: dimensions.width, height: dimensions.height, warnings };
  } finally {
    // 生成失败也要清掉片段、字幕和下载的远程素材，避免长任务反复重试把磁盘占满。
    await rm(input.workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

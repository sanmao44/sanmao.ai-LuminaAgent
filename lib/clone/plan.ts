/**
 * 「一键克隆出片」的纯逻辑层：拆解结果归一化、文案与镜头对齐、
 * 成片时间轴生成、降级判断。这里不碰网络与磁盘，方便直接单测。
 */
import type { CanvasVideoEditorClip } from '../canvas/types';
import type { CloneCapabilities, CloneOptions, CloneShot, CloneStage, CloneTimeline } from './types';

/** 中文口播估算速度：字/秒。没有 TTS 时用它按字数估时长。 */
export const CLONE_CHARS_PER_SECOND = 4.5;
export const CLONE_MIN_SHOT_SECONDS = 0.8;
export const CLONE_MAX_SHOT_SECONDS = 20;
export const CLONE_FRAME_INTERVAL_SECONDS = 2;
export const CLONE_MAX_FRAMES = 10;
export const CLONE_DEFAULT_MAX_SHOTS = 8;
export const CLONE_MAX_SHOTS = 12;
export const CLONE_DEFAULT_MAX_SECONDS = 60;
export const CLONE_MAX_SECONDS = 120;
export const CLONE_MIN_SECONDS = 8;
export const CLONE_MAX_LINES = 12;
export const CLONE_CAPTION_FONT_SIZE = 42;
export const CLONE_CAPTION_BACKGROUND_OPACITY = 0.68;
export const CLONE_ASPECTS = ['9:16', '16:9', '1:1'] as const;

export function round3(value: number) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function text(value: unknown, max = 400) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

/** 只统计可见字符：空白不计入口播时长。 */
export function countVisibleChars(value: unknown) {
  return [...String(value ?? '').replace(/\s+/g, '')].length;
}

/** 按字数估算这一句的口播时长（秒）。 */
export function estimateLineSeconds(value: unknown) {
  const chars = countVisibleChars(value);
  if (!chars) return CLONE_MIN_SHOT_SECONDS;
  return round3(clamp(chars / CLONE_CHARS_PER_SECOND, CLONE_MIN_SHOT_SECONDS, CLONE_MAX_SHOT_SECONDS));
}

export function normalizeCloneOptions(raw: unknown): CloneOptions {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const aspect = text(source.aspect, 8);
  return {
    brief: text(source.brief, 400),
    maxShots: Math.round(clamp(finite(source.maxShots, CLONE_DEFAULT_MAX_SHOTS), 1, CLONE_MAX_SHOTS)),
    maxSeconds: Math.round(clamp(finite(source.maxSeconds, CLONE_DEFAULT_MAX_SECONDS), CLONE_MIN_SECONDS, CLONE_MAX_SECONDS)),
    aspect: (CLONE_ASPECTS as readonly string[]).includes(aspect) ? aspect as CloneOptions['aspect'] : '9:16',
    voice: text(source.voice, 60),
  };
}

/** 等间隔抽帧：取每段中点，避免永远抽到首帧（首帧常常是黑场）。 */
export function frameSampleTimes(durationSeconds: number, intervalSeconds = CLONE_FRAME_INTERVAL_SECONDS, maxFrames = CLONE_MAX_FRAMES) {
  const duration = finite(durationSeconds, 0);
  if (duration <= 0) return [0];
  const count = Math.round(clamp(Math.round(duration / intervalSeconds) || 1, 1, maxFrames));
  return Array.from({ length: count }, (_, index) => round3(((index + 0.5) * duration) / count));
}

/** 平均切分：拆解失败或没有视觉模型时的兜底节奏。 */
export function equalShots(durationSeconds: number, count: number) {
  const duration = Math.max(CLONE_MIN_SHOT_SECONDS, finite(durationSeconds, 0));
  const total = Math.round(clamp(count, 1, CLONE_MAX_SHOTS));
  const each = round3(duration / total);
  return Array.from({ length: total }, (_, index) => ({
    start: round3(index * each),
    end: round3(index === total - 1 ? duration : (index + 1) * each),
  }));
}

export type NormalizedShot = { start: number; end: number; visual: string; prompt: string };

function readShotItem(item: unknown) {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const readNumber = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };
  const start = readNumber('start', 'startSeconds', 'start_seconds', 'from');
  const end = readNumber('end', 'endSeconds', 'end_seconds', 'to');
  const visual = text(raw.visual ?? raw.description ?? raw.summary ?? raw.scene ?? raw.action, 300);
  const prompt = text(raw.prompt ?? raw.imagePrompt ?? raw.image_prompt ?? raw.shot, 400);
  if (start === null && end === null && !visual && !prompt) return null;
  return { start, end, visual, prompt };
}

/**
 * 把模型返回的拆解结果归一化成可信的镜头表：排序、裁剪到参考视频时长内、
 * 丢掉过短的片段、限制镜头数量；模型给不出有效结构时退回等间隔切分。
 */
export function normalizeShots(raw: unknown, options: { durationSeconds: number; maxShots: number }): NormalizedShot[] {
  const duration = Math.max(CLONE_MIN_SHOT_SECONDS, finite(options.durationSeconds, 0));
  const maxShots = Math.round(clamp(finite(options.maxShots, CLONE_DEFAULT_MAX_SHOTS), 1, CLONE_MAX_SHOTS));
  const source = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown> | null)?.shots) ? (raw as Record<string, unknown>).shots as unknown[] : [];
  const parsed = source.map(readShotItem).filter((item): item is NonNullable<ReturnType<typeof readShotItem>> => Boolean(item));
  const withTimes = parsed.filter((item) => item.start !== null || item.end !== null);
  const shots: NormalizedShot[] = [];
  if (withTimes.length) {
    const sorted = [...withTimes].sort((left, right) => finite(left.start, 0) - finite(right.start, 0));
    let cursor = 0;
    for (const item of sorted) {
      if (shots.length >= maxShots) break;
      const start = clamp(finite(item.start, cursor), cursor, duration);
      const end = clamp(finite(item.end, duration), start + CLONE_MIN_SHOT_SECONDS, duration);
      if (end - start < CLONE_MIN_SHOT_SECONDS) continue;
      shots.push({ start: round3(start), end: round3(end), visual: item.visual, prompt: item.prompt });
      cursor = end;
    }
  }
  if (!shots.length) {
    const count = Math.round(clamp(Math.round(duration / 3) || 1, 1, maxShots));
    return equalShots(duration, count).map((slot, index) => ({
      ...slot,
      visual: parsed[index]?.visual || '',
      prompt: parsed[index]?.prompt || '',
    }));
  }
  return shots;
}

/** 把模型写好的文案拆成一句一镜的句子。 */
export function splitLines(raw: unknown): string[] {
  const value = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!value) return [];
  const blocks = value
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/))
    .map((line) => line.replace(/^[\s\-*\d.、）)]+/, '').trim())
    .filter(Boolean);
  return blocks.slice(0, CLONE_MAX_LINES);
}

/**
 * 一句一镜：镜头比句子多时把尾部镜头并进最后一个镜头，
 * 句子比镜头多时把多余句子接在最后一个镜头后面，保证时间轴不出现空镜。
 */
export function alignShotsWithLines(shots: NormalizedShot[], lines: string[]): CloneShot[] {
  if (!shots.length) return [];
  // 一句文案都没有（没有对话模型，或模型没返回句子、画面描述也是空的）时保留全部镜头，
  // 只是整条片子不出字幕；早先会塌缩成 1 个镜头，白白丢掉整条参考片的结构。
  if (!lines.length) {
    return shots.map((shot, index) => ({
      index,
      start: shot.start,
      end: shot.end,
      visual: shot.visual,
      line: '',
      prompt: shot.prompt || shot.visual,
      status: 'pending' as const,
    }));
  }
  const usableLines = lines.length ? lines : [''];
  const keep = Math.max(1, Math.min(shots.length, usableLines.length));
  const kept = shots.slice(0, keep);
  const tail = shots.slice(keep);
  const extraLines = usableLines.slice(keep);
  return kept.map((shot, index) => {
    const isLast = index === keep - 1;
    const line = isLast ? [usableLines[index], ...extraLines].filter(Boolean).join(' ') : usableLines[index];
    return {
      index,
      start: shot.start,
      end: isLast && tail.length ? tail[tail.length - 1].end : shot.end,
      visual: shot.visual,
      line,
      prompt: shot.prompt || shot.visual || line,
      status: 'pending' as const,
    };
  });
}

/**
 * 每个镜头的实际时长：优先用配音真实时长；没有配音但有文案时按字数估算；
 * 连文案都没有（没有对话模型）时退回参考视频这一段本身的时长，
 * 至少保持参考片的节奏，而不是每个镜头都塌成 0.8 秒。
 */
export function shotDurations(shots: CloneShot[]) {
  return shots.map((shot) => {
    const fallback = shot.line
      ? estimateLineSeconds(shot.line)
      : Math.max(0, finite(shot.end, 0) - finite(shot.start, 0));
    return round3(clamp(
      finite(shot.audioSeconds, fallback || estimateLineSeconds(shot.line)),
      CLONE_MIN_SHOT_SECONDS,
      CLONE_MAX_SHOT_SECONDS,
    ));
  });
}

/** 生成成片时间轴：视频轨顺序排布，配音与字幕跟随同一句的起点与时长。 */
export function buildTimeline(shots: CloneShot[], options: CloneOptions): CloneTimeline {
  const durations = shotDurations(shots);
  const clips: CanvasVideoEditorClip[] = [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const duration = durations[index];
    const start = round3(cursor);
    cursor = round3(cursor + duration);
    clips.push({
      id: `clone-video-${index}`,
      track: 'video',
      type: shot.videoUrl ? 'video' : 'image',
      name: `镜头 ${index + 1}`,
      start,
      duration,
      sourceOffset: 0,
      fit: 'cover',
    });
    if (shot.audioUrl) {
      clips.push({
        id: `clone-audio-${index}`,
        track: 'audio',
        type: 'audio',
        name: `配音 ${index + 1}`,
        start,
        duration,
        sourceOffset: 0,
        volume: 1,
      });
    }
    if (shot.line) {
      clips.push({
        id: `clone-caption-${index}`,
        track: 'caption',
        type: 'caption',
        name: `字幕 ${index + 1}`,
        start,
        duration,
        sourceOffset: 0,
        text: shot.line,
        fontSize: CLONE_CAPTION_FONT_SIZE,
        captionBackgroundOpacity: CLONE_CAPTION_BACKGROUND_OPACITY,
      });
    }
  });
  return { duration: round3(cursor), fps: 30, aspect: options.aspect, clips };
}

/** 能力判断与降级说明：缺什么不静默，全部写进 warnings。 */
export function decideCapabilities(input: {
  hasVisionModel: boolean;
  hasSpeechModel: boolean;
  hasImageModel: boolean;
  hasVideoModel: boolean;
  /** 本机离线配音可用（Windows / macOS 自带语音合成），只在没有在线 TTS 模型时才兜底。 */
  offlineSpeech?: boolean;
}): { capabilities: CloneCapabilities; warnings: string[] } {
  const offlineSpeech = !input.hasSpeechModel && Boolean(input.offlineSpeech);
  const warnings: string[] = [];
  if (!input.hasVisionModel) warnings.push('没有声明「视觉」的对话模型：跳过画面拆解，按镜头数平均分配时长。');
  if (!input.hasSpeechModel && !offlineSpeech) warnings.push('没有可用的配音模型：本次成片为无声 + 字幕，时长按字数估算。');
  if (offlineSpeech) warnings.push('没有在线的配音模型：本次改用「本机离线配音」出声（免费、离线、不需联网，音色偏机械）。');
  if (!input.hasImageModel) warnings.push('没有可用的生图模型：无法重新生成画面，请先在模型库启用生图模型。');
  if (!input.hasVideoModel) warnings.push('没有可用的视频模型：镜头改用静态图，成片仍然可以导出。');
  return {
    capabilities: {
      vision: input.hasVisionModel,
      speech: input.hasSpeechModel || offlineSpeech,
      offlineSpeech,
      image: input.hasImageModel,
      video: input.hasVideoModel,
    },
    warnings,
  };
}

/** 从 ffmpeg stderr 里读时长（ffmpeg-static 不带 ffprobe）。 */
export function parseFfmpegDuration(stderr: unknown) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(stderr ?? ''));
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? round3(seconds) : null;
}

const STAGE_PROGRESS: Record<CloneStage, number> = {
  queued: 0,
  analyzing: 0.08,
  scripting: 0.2,
  voicing: 0.3,
  imaging: 0.42,
  rendering: 0.68,
  assembling: 0.94,
  done: 1,
  failed: 0,
  cancelled: 0,
};

export function cloneStageProgress(stage: CloneStage) {
  return STAGE_PROGRESS[stage] ?? 0;
}

export function describeCloneStage(stage: CloneStage) {
  switch (stage) {
    case 'queued': return '已排队';
    case 'analyzing': return '正在拆解参考视频';
    case 'scripting': return '正在重写文案';
    case 'voicing': return '正在生成配音';
    case 'imaging': return '正在生成画面';
    case 'rendering': return '正在生成镜头';
    case 'assembling': return '正在合成时间轴';
    case 'done': return '已完成';
    case 'failed': return '已失败';
    case 'cancelled': return '已取消';
    default: return '';
  }
}

/** 画布弹窗里的能力预判：与服务端 decideCapabilities 用同一套判据，避免两边说法不一致。 */
export type CloneModelSignal = {
  kind: string;
  enabled: boolean;
  published: boolean;
  capabilities?: readonly string[];
};


export type ShotSecondsLimits = {
  minSeconds?: number;
  maxSeconds?: number;
  fixedSeconds?: number;
  allowedSeconds?: readonly number[];
};

/**
 * 把期望时长夹到视频模型真正允许的档位。
 * 例：Agnes Video 2.5 只接受 4–12 秒，按配音算出来的 2 秒会被服务商直接拒单。
 */
export function clampShotSeconds(requested: number, limits: ShotSecondsLimits = {}) {
  const fixed = Number(limits.fixedSeconds);
  if (Number.isFinite(fixed) && fixed > 0) return fixed;
  const min = Number(limits.minSeconds) > 0 ? Number(limits.minSeconds) : 2;
  const max = Number(limits.maxSeconds) >= min ? Number(limits.maxSeconds) : Math.max(min, 10);
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : 4;
  const pool = (limits.allowedSeconds || []).filter((value) => Number.isFinite(value));
  if (pool.length) return pool.reduce((best, value) => (Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best), pool[0]);
  return Math.max(min, Math.min(max, Math.round(wanted)));
}

export function cloneCapabilityFlags(models: readonly CloneModelSignal[]) {
  const usable = models.filter((model) => model.enabled && model.published);
  return {
    // 对话模型决定有没有口播文案：没有它就只能出「纯画面」成片，弹窗要先说清楚。
    hasChatModel: usable.some((model) => model.kind === 'chat'),
    hasVisionModel: usable.some((model) => model.kind === 'chat' && (model.capabilities || []).includes('vision')),
    hasSpeechModel: usable.some((model) => model.kind === 'audio'),
    hasImageModel: usable.some((model) => model.kind === 'image' && (model.capabilities || []).includes('generate')),
    hasVideoModel: usable.some((model) => model.kind === 'video'),
  };
}
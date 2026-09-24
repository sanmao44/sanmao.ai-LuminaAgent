/**
 * 「一键克隆出片」的纯逻辑层：拆解结果归一化、文案与镜头对齐、
 * 成片时间轴生成、降级判断。这里不碰网络与磁盘，方便直接单测。
 */
import type { CanvasVideoEditorClip, CanvasVideoEditorLayout, CanvasVideoEditorLayoutMode } from '../canvas/types';
import type { CloneBlueprint, CloneBlueprintComponent, CloneBlueprintVariantPlan, CloneBlueprintVariantSpec, CloneCapabilities, CloneOptions, CloneShot, CloneShotAnalysis, CloneStage, CloneTimeline, CloneTimelineTrack, CloneTranscript, CloneVisualBible } from './types';
import type { CanvasVideoEditorWord } from '../canvas/types';

/** 中文口播估算速度：字/秒。没有 TTS 时用它按字数估时长。 */
export const CLONE_CHARS_PER_SECOND = 4.5;
export const CLONE_MIN_SHOT_SECONDS = 0.8;
export const CLONE_MAX_SHOT_SECONDS = 20;
// Reference analysis needs enough temporal evidence to recover fast cuts,
// cards and camera motion; the model still receives a bounded number of frames.
export const CLONE_FRAME_INTERVAL_SECONDS = 0.75;
export const CLONE_MAX_FRAMES = 32;
export const CLONE_DEFAULT_MAX_SHOTS = 8;
export const CLONE_MAX_SHOTS = 12;
export const CLONE_DEFAULT_MAX_SECONDS = 60;
export const CLONE_MAX_SECONDS = 120;
export const CLONE_MIN_SECONDS = 8;
export const CLONE_MAX_LINES = 12;
export const CLONE_CAPTION_FONT_SIZE = 42;
export const CLONE_CAPTION_BACKGROUND_OPACITY = 0.68;
export const CLONE_ASPECTS = ['9:16', '16:9', '1:1'] as const;

/** Map vision/OCR position labels to the editor's normalized caption transform. */
export function captionTransformForPosition(position?: string) {
  const value = String(position || '').toLowerCase();
  if (!value) return {} as { x?: number; y?: number };
  const x = value.includes('left') ? -0.72 : value.includes('right') ? 0.72 : 0;
  const y = value.includes('top') ? 1 : value.includes('bottom') ? 0 : 0.73;
  return { x, y };
}

function transitionForShot(shot: CloneShot, index: number) {
  if (index <= 0) return {} as Pick<CanvasVideoEditorClip, 'transitionIn' | 'transitionDuration' | 'transitionDirection'>;
  const analysis = shot.analysis;
  const type = analysis?.transitionType;
  const description = String(analysis?.transition || '').toLocaleLowerCase();
  if (type === 'cut' || type === 'none') return {} as Pick<CanvasVideoEditorClip, 'transitionIn' | 'transitionDuration' | 'transitionDirection'>;
  const transition = type
    ? type
    : /wipe|划入|擦除/u.test(description)
      ? 'wipe'
      : /slide|滑入/u.test(description)
        ? 'slide'
        : /dissolve|cross|叠化|溶解/u.test(description)
          ? 'dissolve'
          : /fade|淡入|淡出/u.test(description)
            ? 'fade'
            : 'cut';
  if (transition === 'cut') return {} as Pick<CanvasVideoEditorClip, 'transitionIn' | 'transitionDuration' | 'transitionDirection'>;
  const direction = /right|右方|右侧/u.test(description)
    ? 'right'
    : /up|上方|上滑/u.test(description)
      ? 'up'
      : /down|下方|下滑/u.test(description)
        ? 'down'
        : 'left';
  return {
    transitionIn: transition,
    transitionDuration: round3(clamp(finite(analysis?.transitionDuration, 0.24), 0.05, 3)),
    transitionDirection: direction,
  } as Pick<CanvasVideoEditorClip, 'transitionIn' | 'transitionDuration' | 'transitionDirection'>;
}

function motionPathForShot(shot: CloneShot) {
  const value = String(shot.analysis?.motionPath || shot.analysis?.motion || '').toLocaleLowerCase();
  if (!value) return {} as Pick<CanvasVideoEditorClip, 'motionPath'>;
  const path = /zoom\s*in|push\s*in|dolly\s*in|推近|推进|放大/u.test(value)
    ? 'zoom-in'
    : /zoom\s*out|pull\s*out|dolly\s*out|拉远|拉开|缩小/u.test(value)
      ? 'zoom-out'
      : /left|向左|左移|左摇/u.test(value)
        ? 'pan-left'
        : /right|向右|右移|右摇/u.test(value)
          ? 'pan-right'
          : /up|向上|上移|上摇/u.test(value)
            ? 'pan-up'
            : /down|向下|下移|下摇/u.test(value)
              ? 'pan-down'
              : 'none';
  return { motionPath: path } as Pick<CanvasVideoEditorClip, 'motionPath'>;
}

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
    preserveReferenceTiming: source.preserveReferenceTiming !== false,
    preserveReferenceAudio: source.preserveReferenceAudio !== false,
  };
}

/** 等间隔抽帧：取每段中点，避免永远抽到首帧（首帧常常是黑场）。 */
export function frameSampleTimes(durationSeconds: number, intervalSeconds = CLONE_FRAME_INTERVAL_SECONDS, maxFrames = CLONE_MAX_FRAMES) {
  const duration = finite(durationSeconds, 0);
  if (duration <= 0) return [0];
  const count = Math.round(clamp(Math.round(duration / intervalSeconds) || 1, 1, maxFrames));
  return Array.from({ length: count }, (_, index) => round3(((index + 0.5) * duration) / count));
}

function normalizedSceneChanges(durationSeconds: number, sceneChangeTimes: number[]) {
  const duration = Math.max(CLONE_MIN_SHOT_SECONDS, finite(durationSeconds, 0));
  const seen = new Set<number>();
  return sceneChangeTimes
    .map((time) => round3(finite(time, -1)))
    .filter((time) => time > 0 && time < duration)
    .sort((left, right) => left - right)
    .filter((time) => {
      if (seen.has(time)) return false;
      seen.add(time);
      return true;
    });
}

/**
 * Sample around locally detected cuts as well as inside every resulting
 * interval. This makes a fast card/transition visible to the vision model
 * instead of hiding it between two uniform samples.
 */
export function referenceFrameSampleTimes(durationSeconds: number, sceneChangeTimes: number[] = [], maxFrames = CLONE_MAX_FRAMES) {
  const duration = Math.max(CLONE_MIN_SHOT_SECONDS, finite(durationSeconds, 0));
  const changes = normalizedSceneChanges(duration, sceneChangeTimes);
  if (!changes.length) return frameSampleTimes(duration, CLONE_FRAME_INTERVAL_SECONDS, maxFrames);
  const points = [0, ...changes, duration];
  const candidates = new Set<number>();
  changes.forEach((time) => {
    candidates.add(round3(clamp(time - 0.12, 0.02, duration - 0.02)));
    candidates.add(round3(clamp(time + 0.12, 0.02, duration - 0.02)));
  });
  for (let index = 0; index < points.length - 1; index += 1) {
    candidates.add(round3((points[index] + points[index + 1]) / 2));
  }
  const sorted = [...candidates].filter((time) => time > 0 && time < duration).sort((left, right) => left - right);
  const limit = Math.max(1, Math.round(finite(maxFrames, CLONE_MAX_FRAMES)));
  if (sorted.length <= limit) return sorted;
  return Array.from({ length: limit }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / Math.max(1, limit - 1))]);
}

/** Convert local cut timestamps into a deterministic fallback shot plan. */
export function shotsFromSceneChanges(durationSeconds: number, sceneChangeTimes: number[], maxShots: number) {
  const duration = Math.max(CLONE_MIN_SHOT_SECONDS, finite(durationSeconds, 0));
  const changes = normalizedSceneChanges(duration, sceneChangeTimes);
  const limit = Math.max(1, Math.round(clamp(finite(maxShots, CLONE_DEFAULT_MAX_SHOTS), 1, CLONE_MAX_SHOTS)));
  const selected = changes.length <= limit - 1
    ? changes
    : Array.from({ length: limit - 1 }, (_, index) => changes[Math.round(index * (changes.length - 1) / Math.max(1, limit - 2))]);
  const points = [0, ...selected, duration];
  return points.slice(0, -1).map((start, index) => ({
    start: round3(start),
    end: round3(points[index + 1]),
    visual: '',
    prompt: '',
  }));
}

/** Snap model-predicted boundaries to a nearby real cut without rewriting its semantic shot plan. */
export function snapShotBoundariesToSceneChanges<T extends { start: number; end: number }>(shots: T[], sceneChangeTimes: number[], tolerance = 0.35) {
  if (!shots.length) return shots;
  const changes = normalizedSceneChanges(Math.max(...shots.map((shot) => shot.end), CLONE_MIN_SHOT_SECONDS), sceneChangeTimes);
  const snap = (value: number) => {
    const nearest = changes.reduce<{ value: number; distance: number } | null>((best, change) => {
      const distance = Math.abs(change - value);
      return distance <= tolerance && (!best || distance < best.distance) ? { value: change, distance } : best;
    }, null);
    return nearest?.value ?? value;
  };
  const originalBoundaries = [shots[0].start, ...shots.map((shot) => shot.end)];
  const snappedBoundaries = originalBoundaries.map((value, index) => index === 0 || index === originalBoundaries.length - 1 ? value : snap(value));
  if (snappedBoundaries.some((value, index) => index > 0 && value <= snappedBoundaries[index - 1])) return shots;
  if (snappedBoundaries.slice(1).some((value, index) => value - snappedBoundaries[index] < CLONE_MIN_SHOT_SECONDS)) return shots;
  return shots.map((shot, index) => ({
    ...shot,
    start: snappedBoundaries[index],
    end: snappedBoundaries[index + 1],
  }));
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

export type NormalizedShot = {
  start: number;
  end: number;
  visual: string;
  prompt: string;
  analysis?: CloneShotAnalysis;
  /** A time-only gap added to keep the reference timeline fully covered. */
  referenceGap?: boolean;
  /** Gaps have no semantic replacement, so keep their original moving source. */
  preserveReferenceFrame?: boolean;
};

/**
 * Compile recovered shot structure into a bounded provider direction.
 *
 * The reference frame/video remains the visual authority; this string is only
 * the execution handoff for a replacement subject or generated B-roll. Keeping
 * it structured prevents image/video providers from seeing a bare prose prompt
 * and silently dropping the recovered camera, layout, motion, or style.
 */
export function cloneShotDirection(
  shot: Pick<CloneShot, 'visual' | 'line' | 'prompt' | 'analysis'>,
  brief = '',
  visualBible?: CloneVisualBible,
) {
  const analysis = shot.analysis;
  const bibleParts = visualBible
    ? [
      visualBible.subjectIdentity ? `全片主体身份与外观统一：${visualBible.subjectIdentity}` : '',
      visualBible.productIdentity ? `全片产品/包装统一：${visualBible.productIdentity}` : '',
      visualBible.brandLanguage ? `品牌语言统一：${visualBible.brandLanguage}` : '',
      visualBible.visualStyle ? `全片视觉风格统一：${visualBible.visualStyle}` : '',
      visualBible.palette ? `全片色彩/材质统一：${visualBible.palette}` : '',
      visualBible.lighting ? `全片光线统一：${visualBible.lighting}` : '',
      visualBible.cameraGrammar ? `全片摄影语法统一：${visualBible.cameraGrammar}` : '',
      visualBible.continuityRules ? `跨镜头连续性规则：${visualBible.continuityRules}` : '',
      visualBible.negativeConstraints ? `全片禁止项：${visualBible.negativeConstraints}` : '',
    ].filter(Boolean)
    : [];
  const parts = [
    shot.prompt || shot.visual || shot.line,
    shot.visual && shot.prompt && shot.visual !== shot.prompt ? `参考画面内容：${shot.visual}` : '',
    analysis?.camera ? `机位/镜头：${analysis.camera}` : '',
    analysis?.composition ? `构图与主体位置：${analysis.composition}` : '',
    analysis?.motion ? `镜头运动与动作节奏：${analysis.motion}` : '',
    analysis?.visualStyle ? `视觉风格、光线与色彩：${analysis.visualStyle}` : '',
    analysis?.layout ? `空间布局：${analysis.layout.mode}${analysis.layout.primary ? `，主区域 ${JSON.stringify(analysis.layout.primary)}` : ''}${analysis.layout.secondary ? `，辅区域 ${JSON.stringify(analysis.layout.secondary)}` : ''}` : '',
    analysis?.graphicsText ? `画面已有字卡由后期结构化叠加，生成画面不要臆造文字：${analysis.graphicsText}` : '',
    analysis?.graphicsStyle ? `字卡样式参考：${analysis.graphicsStyle}` : '',
    ...bibleParts,
    brief ? `本次主题：${brief}` : '',
    '保持参考镜头的景别、主体相对位置、画面留白、运动方向和切换节奏；只替换明确要求变化的主体，不新增水印或无关文字。',
  ].filter(Boolean);
  return parts.join('；').replace(/\s+/gu, ' ').trim().slice(0, 2400);
}

const SHOT_ROLES = new Set(['performance', 'broll', 'graphic', 'transition', 'product', 'other']);

function readLayout(value: unknown): CanvasVideoEditorLayout | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const modes: CanvasVideoEditorLayoutMode[] = ['full', 'split-horizontal', 'split-vertical', 'picture-in-picture', 'card'];
  const mode = modes.includes(raw.mode as CanvasVideoEditorLayoutMode) ? raw.mode as CanvasVideoEditorLayoutMode : undefined;
  if (!mode) return undefined;
  const color = (candidate: unknown) => {
    const result = String(candidate || '').trim().slice(0, 48);
    return /^#[0-9a-f]{3,8}$/iu.test(result) || /^(?:rgba?|hsla?)\([^)]{1,80}\)$/iu.test(result) || /^[a-z]{3,20}$/iu.test(result) ? result : undefined;
  };
  const region = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const item = candidate as Record<string, unknown>;
    const x = Number(item.x); const y = Number(item.y); const width = Number(item.width); const height = Number(item.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
    const boundedX = clamp(x, 0, 0.99); const boundedY = clamp(y, 0, 0.99);
    return {
      x: round3(boundedX), y: round3(boundedY),
      width: round3(clamp(width, 0.01, 1 - boundedX)), height: round3(clamp(height, 0.01, 1 - boundedY)),
      ...(Number.isFinite(Number(item.radius)) ? { radius: round3(clamp(Number(item.radius), 0, 0.5)) } : {}),
    };
  };
  const primary = region(raw.primary); const secondary = region(raw.secondary);
  return {
    mode,
    ...(color(raw.backgroundColor) ? { backgroundColor: color(raw.backgroundColor) } : {}),
    ...(color(raw.surfaceColor) ? { surfaceColor: color(raw.surfaceColor) } : {}),
    ...(color(raw.accentColor) ? { accentColor: color(raw.accentColor) } : {}),
    ...(Number.isFinite(Number(raw.gap)) ? { gap: round3(clamp(Number(raw.gap), 0, 0.2)) } : {}),
    ...(Number.isFinite(Number(raw.padding)) ? { padding: round3(clamp(Number(raw.padding), 0, 0.2)) } : {}),
    ...(Number.isFinite(Number(raw.radius)) ? { radius: round3(clamp(Number(raw.radius), 0, 0.5)) } : {}),
    ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}),
  };
}

function inferLayoutFromComposition(value: string | undefined): CanvasVideoEditorLayout | undefined {
  const textValue = String(value || '').toLocaleLowerCase();
  if (!textValue) return undefined;
  if (/picture\s*-?in\s*-?picture|pip|画中画|画中画/u.test(textValue)) {
    return { mode: 'picture-in-picture', backgroundColor: '#000', primary: { x: 0, y: 0, width: 1, height: 1 }, secondary: { x: 0.64, y: 0.64, width: 0.3, height: 0.3, radius: 0.04 } };
  }
  if (/split|side\s*by\s*side|左右分栏|左右布局|双栏/u.test(textValue)) {
    return { mode: 'split-horizontal', backgroundColor: '#000', gap: 0.02, primary: { x: 0, y: 0, width: 0.49, height: 1 }, secondary: { x: 0.51, y: 0, width: 0.49, height: 1 } };
  }
  if (/上下分区|上下布局|top\s*and\s*bottom|vertical\s*split|上下分栏/u.test(textValue)) {
    return { mode: 'split-vertical', backgroundColor: '#000', gap: 0.02, primary: { x: 0, y: 0, width: 1, height: 0.49 }, secondary: { x: 0, y: 0.51, width: 1, height: 0.49 } };
  }
  if (/card|panel|tile|卡片|色块|圆角|rounded/u.test(textValue)) {
    return { mode: 'card', backgroundColor: '#101014', surfaceColor: '#26262d', padding: 0.06, radius: 0.06, primary: { x: 0.06, y: 0.06, width: 0.88, height: 0.88, radius: 0.06 } };
  }
  return undefined;
}

/**
 * Decide whether a shot is a visual-system layer rather than a replaceable
 * subject shot. Cards, split layouts and transitions should keep the source
 * video animation; ordinary shots with a small title overlay still go through
 * image/video generation so the subject can be localized.
 */
export function shouldPreserveReferenceFrameAnalysis(analysis?: CloneShotAnalysis) {
  if (!analysis) return false;
  if (analysis.role === 'graphic' || analysis.role === 'transition') return true;
  if (analysis.layout?.mode && analysis.layout.mode !== 'full') return true;
  if (analysis.transitionType && !['cut', 'none'].includes(analysis.transitionType)) return true;
  const structuralText = `${analysis.graphics || ''} ${analysis.graphicsStyle || ''} ${analysis.composition || ''}`.toLocaleLowerCase();
  const bounds = analysis.graphicsBounds;
  const coversComposition = Boolean(bounds && bounds.width * bounds.height >= 0.42);
  return Boolean(analysis.graphicsText && (coversComposition || /card|panel|banner|title card|卡片|面板|横幅|标题卡|全屏字卡/u.test(structuralText)));
}

function readShotAnalysis(raw: Record<string, unknown>): CloneShotAnalysis | undefined {
  const source = raw.analysis && typeof raw.analysis === 'object' ? raw.analysis as Record<string, unknown> : raw;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = text(source[key], 180);
      if (value) return value;
    }
    return undefined;
  };
  const readNumber = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(source[key]);
      if (Number.isFinite(value) && value >= 0) return round3(value);
    }
    return undefined;
  };
  const readBounds = (...keys: string[]) => {
    for (const key of keys) {
      const value = source[key];
      if (!value || typeof value !== 'object') continue;
      const box = value as Record<string, unknown>;
      const rawX = Number(box.x);
      const rawY = Number(box.y);
      const rawWidth = Number(box.width);
      const rawHeight = Number(box.height);
      if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawX < 0 || rawY < 0 || rawWidth <= 0 || rawHeight <= 0) continue;
      const x = clamp(rawX, 0, 0.99);
      const y = clamp(rawY, 0, 0.99);
      const width = clamp(rawWidth, 0.01, 1 - x);
      const height = clamp(rawHeight, 0.01, 1 - y);
      if (width > 0 && height > 0) return { x: round3(x), y: round3(y), width: round3(width), height: round3(height) };
    }
    return undefined;
  };
  const role = String(source.role || source.referenceRole || '').trim();
  const rawTransitionType = String(source.transitionType || source.transition_type || '').trim().toLowerCase();
  const transitionType = ['cut', 'fade', 'dissolve', 'wipe', 'slide', 'none'].includes(rawTransitionType)
    ? rawTransitionType as CloneShotAnalysis['transitionType']
    : undefined;
  const layout = readLayout(source.layout || source.compositionLayout || source.composition_layout)
    || inferLayoutFromComposition(read('composition', 'framing', 'layout'));
  const analysis: CloneShotAnalysis = {
    ...(read('camera', 'cameraLanguage', 'camera_language') ? { camera: read('camera', 'cameraLanguage', 'camera_language') } : {}),
    ...(read('composition', 'framing', 'layout') ? { composition: read('composition', 'framing', 'layout') } : {}),
    ...(read('motion', 'cameraMotion', 'camera_motion', 'action') ? { motion: read('motion', 'cameraMotion', 'camera_motion', 'action') } : {}),
    ...(read('visualStyle', 'visual_style', 'style') ? { visualStyle: read('visualStyle', 'visual_style', 'style') } : {}),
    ...(read('graphics', 'onScreenText', 'on_screen_text', 'card') ? { graphics: read('graphics', 'onScreenText', 'on_screen_text', 'card') } : {}),
    ...(read('graphicsText', 'graphics_text', 'ocrText', 'ocr_text', 'onscreenText', 'onscreen_text') ? { graphicsText: read('graphicsText', 'graphics_text', 'ocrText', 'ocr_text', 'onscreenText', 'onscreen_text') } : {}),
    ...(read('graphicsPosition', 'graphics_position', 'textPosition', 'text_position') ? { graphicsPosition: read('graphicsPosition', 'graphics_position', 'textPosition', 'text_position') } : {}),
    ...(read('graphicsStyle', 'graphics_style', 'cardStyle', 'card_style') ? { graphicsStyle: read('graphicsStyle', 'graphics_style', 'cardStyle', 'card_style') } : {}),
    ...(readBounds('graphicsBounds', 'graphics_bounds', 'textBox', 'text_box') ? { graphicsBounds: readBounds('graphicsBounds', 'graphics_bounds', 'textBox', 'text_box') } : {}),
    ...(layout ? { layout } : {}),
    ...(read('audio', 'sound', 'soundDesign', 'sound_design') ? { audio: read('audio', 'sound', 'soundDesign', 'sound_design') } : {}),
    ...(read('transition', 'edit', 'cut') ? { transition: read('transition', 'edit', 'cut') } : {}),
    ...(transitionType ? { transitionType } : {}),
    ...(readNumber('transitionDuration', 'transition_duration', 'transitionSeconds', 'transition_seconds') !== undefined ? { transitionDuration: readNumber('transitionDuration', 'transition_duration', 'transitionSeconds', 'transition_seconds') } : {}),
    ...(read('motionPath', 'motion_path', 'movementPath', 'movement_path') ? { motionPath: read('motionPath', 'motion_path', 'movementPath', 'movement_path') } : {}),
    ...(SHOT_ROLES.has(role) ? { role: role as CloneShotAnalysis['role'] } : {}),
  };
  return Object.keys(analysis).length ? analysis : undefined;
}

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
  return { start, end, visual, prompt, analysis: readShotAnalysis(raw) };
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
  const addReferenceGap = (start: number, end: number) => {
    const safeStart = round3(Math.max(0, start));
    const safeEnd = round3(Math.min(duration, end));
    if (safeEnd <= safeStart) return;
    shots.push({
      start: safeStart,
      end: safeEnd,
      visual: '',
      prompt: '',
      referenceGap: true,
      preserveReferenceFrame: true,
    });
  };
  if (withTimes.length) {
    const sorted = [...withTimes].sort((left, right) => finite(left.start, 0) - finite(right.start, 0));
    let cursor = 0;
    for (const item of sorted) {
      if (shots.length >= maxShots) break;
      let start = clamp(finite(item.start, cursor), cursor, duration);
      const end = clamp(finite(item.end, duration), start + CLONE_MIN_SHOT_SECONDS, duration);
      if (end - start < CLONE_MIN_SHOT_SECONDS) continue;
      const gap = start - cursor;
      if (gap >= CLONE_MIN_SHOT_SECONDS && shots.length < maxShots - 1) {
        addReferenceGap(cursor, start);
      } else if (gap > 0) {
        // Keep the max-shot contract without dropping any source frames. A
        // tiny gap is absorbed by the neighboring semantic shot; when the
        // limit is reached, extend the previous shot to the next real cut.
        if (shots.length) shots[shots.length - 1].end = round3(start);
        else start = 0;
      }
      if (shots.length >= maxShots) break;
      shots.push({ start: round3(start), end: round3(end), visual: item.visual, prompt: item.prompt, ...(item.analysis ? { analysis: item.analysis } : {}) });
      cursor = end;
    }
    if (shots.length) {
      const last = shots[shots.length - 1];
      const tail = duration - last.end;
      if (tail >= CLONE_MIN_SHOT_SECONDS && shots.length < maxShots) addReferenceGap(last.end, duration);
      else if (tail > 0) last.end = round3(duration);
    }
  }
  if (!shots.length) {
    const count = Math.round(clamp(Math.round(duration / 3) || 1, 1, maxShots));
    return equalShots(duration, count).map((slot, index) => ({
      ...slot,
      visual: parsed[index]?.visual || '',
       prompt: parsed[index]?.prompt || '',
       ...(parsed[index]?.analysis ? { analysis: parsed[index].analysis } : {}),
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
export function alignShotsWithLines(shots: NormalizedShot[], lines: string[], options: { preserveShotStructure?: boolean } = {}): CloneShot[] {
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
      ...(shot.referenceGap ? { referenceGap: true } : {}),
       ...(shot.analysis ? { analysis: shot.analysis } : {}),
      ...(shot.preserveReferenceFrame ? { preserveReferenceFrame: true } : {}),
      status: 'pending' as const,
    }));
  }
  if (options.preserveShotStructure) {
    const semanticIndexes = shots.map((shot, index) => ({ shot, index })).filter(({ shot }) => !shot.referenceGap);
    const semanticLines = lines.slice(0, semanticIndexes.length);
    if (lines.length > semanticIndexes.length && semanticLines.length) {
      semanticLines[semanticLines.length - 1] = [semanticLines[semanticLines.length - 1], ...lines.slice(semanticIndexes.length)].filter(Boolean).join(' ');
    }
    const lineByIndex = new Map<number, string>();
    semanticIndexes.forEach(({ index }, semanticIndex) => lineByIndex.set(index, semanticLines[semanticIndex] || ''));
    return shots.map((shot, index) => ({
      index,
      start: shot.start,
      end: shot.end,
      visual: shot.visual,
      line: lineByIndex.get(index) || '',
      prompt: shot.prompt || shot.visual || lineByIndex.get(index) || '',
      ...(shot.referenceGap ? { referenceGap: true } : {}),
      ...(shot.analysis ? { analysis: shot.analysis } : {}),
      ...(shot.preserveReferenceFrame ? { preserveReferenceFrame: true } : {}),
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
      ...(shot.referenceGap ? { referenceGap: true } : {}),
       ...(shot.analysis ? { analysis: shot.analysis } : {}),
      ...(shot.preserveReferenceFrame ? { preserveReferenceFrame: true } : {}),
      status: 'pending' as const,
    };
  });
}

/**
 * 每个镜头的实际时长：优先用配音真实时长；没有配音但有文案时按字数估算；
 * 连文案都没有（没有对话模型）时退回参考视频这一段本身的时长，
 * 至少保持参考片的节奏，而不是每个镜头都塌成 0.8 秒。
 */
export function shotDurations(shots: CloneShot[], options: Pick<CloneOptions, 'preserveReferenceTiming'> = { preserveReferenceTiming: false }) {
  return shots.map((shot) => {
    const referenceDuration = Math.max(0, finite(shot.end, 0) - finite(shot.start, 0));
    const fallback = shot.line
      ? estimateLineSeconds(shot.line)
      : referenceDuration;
    const requested = finite(shot.audioSeconds, fallback || estimateLineSeconds(shot.line));
    const timed = options.preserveReferenceTiming !== false && referenceDuration > 0
      ? Math.max(referenceDuration, requested)
      : requested;
    return round3(clamp(
      timed,
      CLONE_MIN_SHOT_SECONDS,
      CLONE_MAX_SHOT_SECONDS,
    ));
  });
}

function captionTokens(value: string) {
  const raw = value.match(/\s+|[\u3400-\u9fff\uf900-\ufaff]|[\p{L}\p{N}]+|[^\s]/gu) || [];
  const tokens: string[] = [];
  for (const token of raw) {
    if (/^\s+$/u.test(token) && tokens.length) tokens[tokens.length - 1] += token;
    else if (!/^\s+$/u.test(token)) tokens.push(token);
  }
  return tokens;
}

/**
 * Keep the rewritten caption's rhythm anchored to the recovered reference
 * speech. The words are relative to the generated caption clip, so the
 * editor can move or trim the clip without having to know the source-video
 * clock. When ASR is unavailable, the same shape is deterministically spread
 * across the shot as a useful local fallback.
 */
export function captionWordsForShot(
  textValue: string,
  shot: Pick<CloneShot, 'start' | 'end' | 'audioWords'>,
  duration: number,
  transcript?: CloneTranscript | null,
): CanvasVideoEditorWord[] {
  const tokens = captionTokens(textValue.trim());
  if (!tokens.length || duration <= 0) return [];
  const sourceStart = finite(shot.start, 0);
  const sourceEnd = Math.max(sourceStart, finite(shot.end, sourceStart));
  const alignedWords = shot.audioWords?.length ? shot.audioWords : undefined;
  const relativeAlignment = Boolean(alignedWords?.length);
  const recovered = (alignedWords
    ? alignedWords
      .filter((word) => word.end > 0 && word.start < duration && word.text.trim())
      .map((word) => ({
        start: clamp(word.start, 0, duration),
        end: clamp(Math.max(word.end, word.start), 0, duration),
        weight: Math.max(1, captionTokens(word.text).length),
      }))
    : (transcript?.words || [])
      .filter((word) => word.end > sourceStart && word.start < sourceEnd && word.text.trim())
      .map((word) => ({
        start: clamp(word.start, sourceStart, sourceEnd),
        end: clamp(Math.max(word.end, word.start), sourceStart, sourceEnd),
        weight: Math.max(1, captionTokens(word.text).length),
      })))
    .filter((word) => word.end > word.start);
  if (relativeAlignment && recovered.length === tokens.length) {
    return tokens.map((token, index) => ({
      start: round3(clamp(recovered[index].start, 0, Math.max(0, duration - 0.01))),
      end: round3(clamp(Math.max(recovered[index].start + 0.01, recovered[index].end), recovered[index].start + 0.01, duration)),
      text: token,
    }));
  }
  const referenceDuration = Math.max(0.01, sourceEnd - sourceStart);
  const activeStart = recovered.length ? Math.min(...recovered.map((word) => word.start)) : (relativeAlignment ? 0 : sourceStart);
  const activeEnd = recovered.length ? Math.max(...recovered.map((word) => word.end)) : (relativeAlignment ? duration : sourceEnd);
  const outputStart = relativeAlignment ? clamp(activeStart, 0, duration) : recovered.length ? clamp(((activeStart - sourceStart) / referenceDuration) * duration, 0, duration) : 0;
  const outputEnd = relativeAlignment ? clamp(activeEnd, outputStart, duration) : recovered.length ? clamp(((activeEnd - sourceStart) / referenceDuration) * duration, outputStart, duration) : duration;
  const activeDuration = Math.max(0.01, outputEnd - outputStart);
  const totalWeight = recovered.reduce((sum, word) => sum + word.weight, 0);
  const mapFraction = (fraction: number) => {
    if (!recovered.length) return outputStart + fraction * activeDuration;
    let cursor = 0;
    for (const word of recovered) {
      const next = cursor + word.weight / totalWeight;
      if (fraction <= next || word === recovered.at(-1)) {
        const local = (fraction - cursor) / Math.max(0.0001, next - cursor);
        const sourceTime = word.start + (word.end - word.start) * clamp(local, 0, 1);
        return relativeAlignment
          ? sourceTime
          : outputStart + ((sourceTime - activeStart) / Math.max(0.01, activeEnd - activeStart)) * activeDuration;
      }
      cursor = next;
    }
    return outputEnd;
  };
  return tokens.map((token, index) => {
    const rawStart = mapFraction(index / tokens.length);
    const rawEnd = mapFraction((index + 1) / tokens.length);
    const start = round3(clamp(rawStart, 0, Math.max(0, duration - 0.01)));
    const end = round3(clamp(Math.max(start + 0.01, rawEnd), start + 0.01, duration));
    return { start, end, text: token };
  });
}

function componentSignature(shot: CloneShot) {
  const analysis = shot.analysis;
  const layout = analysis?.layout;
  return JSON.stringify({
    role: analysis?.role || (shot.preserveReferenceFrame ? 'graphic' : 'other'),
    source: shot.preserveReferenceFrame ? 'preserve-reference' : 'generate-media',
    layout: layout ? {
      mode: layout.mode,
      primary: layout.primary,
      secondary: layout.secondary,
    } : undefined,
    motionPath: analysis?.motionPath || analysis?.motion,
    graphicsStyle: analysis?.graphicsStyle,
    transitionType: analysis?.transitionType,
  });
}

/** Group repeated recovered visual structures into reusable Blueprint components. */
export function buildBlueprintComponents(shots: CloneShot[]): CloneBlueprintComponent[] {
  const groups = new Map<string, CloneBlueprintComponent>();
  shots.forEach((shot, index) => {
    const analysis = shot.analysis;
    const role = analysis?.role || (shot.preserveReferenceFrame ? 'graphic' : 'other');
    const source = shot.preserveReferenceFrame ? 'preserve-reference' : 'generate-media';
    const signature = componentSignature(shot);
    const existing = groups.get(signature);
    if (existing) {
      existing.shotIndexes.push(index);
      return;
    }
    const id = `clone-component-${groups.size + 1}`;
    groups.set(signature, {
      id,
      role,
      label: role === 'performance' ? '人物表现' : role === 'broll' ? 'B-roll' : role === 'product' ? '产品展示' : role === 'graphic' ? '图形卡片' : role === 'transition' ? '转场' : '镜头组件',
      source,
      shotIndexes: [index],
      ...(analysis?.layout ? { layout: analysis.layout } : {}),
      ...(analysis?.motionPath || analysis?.motion
        ? (() => {
          const motionPath = motionPathForShot(shot).motionPath;
          return motionPath ? { motionPath } : {};
        })()
        : {}),
      ...(analysis?.graphicsStyle ? { graphicsStyle: analysis.graphicsStyle } : {}),
      ...(analysis?.transitionType ? { transitionType: analysis.transitionType } : {}),
    });
  });
  return [...groups.values()];
}

/** 生成成片时间轴：视频轨顺序排布，配音与字幕跟随同一句的起点与时长。 */
function variantText(value: unknown, fallback = '') {
  return String(value ?? fallback).replace(/\r\n?/g, '\n').trim().slice(0, 2000);
}

function variantTargetIndexes(
  override: CloneBlueprintVariantSpec['overrides'][number],
  components: CloneBlueprintComponent[],
  shotCount: number,
) {
  const indexes = new Set<number>();
  if (Array.isArray(override.shotIndexes)) {
    override.shotIndexes.forEach((index) => {
      const value = Number(index);
      if (Number.isInteger(value) && value >= 0 && value < shotCount) indexes.add(value);
    });
  }
  if (override.componentId) {
    components.find((item) => item.id === override.componentId)?.shotIndexes.forEach((index) => {
      if (index >= 0 && index < shotCount) indexes.add(index);
    });
  }
  if (!override.componentId && !Array.isArray(override.shotIndexes)) {
    for (let index = 0; index < shotCount; index += 1) indexes.add(index);
  }
  return indexes;
}

/**
 * Expand a Blueprint into a deterministic local variant. Existing media is
 * reused; only `generationShotIndexes` require a new provider request.
 */
export function buildBlueprintVariantPlan(
  blueprint: CloneBlueprint,
  spec: CloneBlueprintVariantSpec,
  options: CloneOptions,
  transcript?: CloneTranscript | null,
): CloneBlueprintVariantPlan {
  const shots = blueprint.shots.map((shot) => ({
    ...shot,
    ...(shot.analysis ? { analysis: { ...shot.analysis } } : {}),
    ...(shot.assetIds ? { assetIds: [...shot.assetIds] } : {}),
  }));
  const components = blueprint.components?.length ? blueprint.components : buildBlueprintComponents(shots);
  const generation = new Set<number>();
  const voice = new Set<number>();
  const changedMedia = new Set<number>();

  for (const rawOverride of spec.overrides || []) {
    const override = rawOverride || {};
    variantTargetIndexes(override, components, shots.length).forEach((index) => {
      const current = shots[index];
      if (!current) return;
      const currentAnalysis = current.analysis || {};
      const visualChanged = override.visual !== undefined && variantText(override.visual) !== current.visual;
      const promptChanged = override.prompt !== undefined && variantText(override.prompt) !== current.prompt;
      const assetsChanged = override.assetIds !== undefined && JSON.stringify(override.assetIds) !== JSON.stringify(current.assetIds || []);
      const textValue = override.text !== undefined ? variantText(override.text) : undefined;
      const lineValue = override.line !== undefined ? variantText(override.line) : textValue;
      const lineChanged = lineValue !== undefined && lineValue !== current.line;
      const shouldRegenerate = Boolean(override.regenerate || visualChanged || promptChanged || assetsChanged || override.preserveReferenceFrame === false);
      const allowsReferenceOverlays = override.allowReferenceOverlays === true
        || (override.allowReferenceOverlays !== false && Boolean(
          override.line !== undefined
          || override.text !== undefined
          || override.graphicsText !== undefined
          || override.layout !== undefined
          || override.motionPath !== undefined
          || override.graphicsStyle !== undefined,
        ));
      shots[index] = {
        ...current,
        ...(override.visual !== undefined ? { visual: variantText(override.visual) } : {}),
        ...(lineValue !== undefined ? { line: lineValue } : {}),
        ...(override.prompt !== undefined ? { prompt: variantText(override.prompt) } : {}),
        ...(override.assetIds !== undefined ? { assetIds: [...new Set(override.assetIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))] } : {}),
        ...(lineValue !== undefined && lineValue !== current.line && !lineValue
          ? { audioUrl: undefined, audioSeconds: undefined }
          : {}),
        analysis: {
          ...currentAnalysis,
          ...(override.layout !== undefined ? { layout: override.layout } : {}),
          ...(override.motionPath !== undefined ? { motionPath: override.motionPath } : {}),
          ...(override.graphicsText !== undefined ? { graphicsText: variantText(override.graphicsText) } : {}),
          ...(override.graphicsStyle !== undefined ? { graphicsStyle: variantText(override.graphicsStyle, currentAnalysis.graphicsStyle) } : {}),
        },
        ...(override.preserveReferenceFrame !== undefined || shouldRegenerate
          ? { preserveReferenceFrame: override.preserveReferenceFrame !== undefined ? Boolean(override.preserveReferenceFrame) : false }
          : {}),
        ...(allowsReferenceOverlays && !shouldRegenerate ? { allowReferenceOverlays: true } : {}),
      };
      if (shouldRegenerate) {
        changedMedia.add(index);
        generation.add(index);
      }
      if ((lineChanged && Boolean(shots[index].line?.trim())) || (shots[index].line && !shots[index].audioUrl)) voice.add(index);
    });
  }

  shots.forEach((shot, index) => {
    if (!shot.preserveReferenceFrame && !shot.videoUrl && !shot.imageUrl) generation.add(index);
    if (shot.line && !shot.audioUrl) voice.add(index);
  });
  const timeline = buildTimeline(shots, options, transcript);
  return {
    id: variantText(spec.id, `variant-${Date.now()}`).slice(0, 80),
    name: variantText(spec.name, '本地变体').slice(0, 120),
    ...(spec.description ? { description: variantText(spec.description).slice(0, 400) } : {}),
    shots,
    timeline,
    generationShotIndexes: [...generation].sort((a, b) => a - b),
    voiceShotIndexes: [...voice].sort((a, b) => a - b),
    reusedShotIndexes: shots.map((_, index) => index).filter((index) => !changedMedia.has(index)),
  };
}

/** Expand a batch of named variants without re-running analysis or providers. */
export function buildBlueprintVariantPlans(
  blueprint: CloneBlueprint,
  specs: CloneBlueprintVariantSpec[],
  options: CloneOptions,
  transcript?: CloneTranscript | null,
) {
  return specs.map((spec) => buildBlueprintVariantPlan(blueprint, spec, options, transcript));
}

export function buildTimeline(shots: CloneShot[], options: CloneOptions, transcript?: CloneTranscript | null): CloneTimeline {
  const durations = shotDurations(shots, options);
  const components = buildBlueprintComponents(shots);
  const componentForShot = new Map<number, CloneBlueprintComponent>();
  components.forEach((component) => component.shotIndexes.forEach((index) => componentForShot.set(index, component)));
  const clips: CanvasVideoEditorClip[] = [];
  const videoTrack: CloneTimelineTrack = { id: 'clone-track-video', kind: 'video', label: '视频画面', clips: [] };
  const referenceAudioTrack: CloneTimelineTrack = { id: 'clone-track-reference-audio', kind: 'reference-audio', label: '参考环境音 / 音乐', clips: [] };
  const voiceTrack: CloneTimelineTrack = { id: 'clone-track-voice', kind: 'voice', label: '新配音', clips: [] };
  const captionTrack: CloneTimelineTrack = { id: 'clone-track-caption', kind: 'caption', label: '新字幕', clips: [] };
  const graphicsTrack: CloneTimelineTrack = { id: 'clone-track-graphics', kind: 'graphics', label: '画面字卡', clips: [] };
  let cursor = 0;
  shots.forEach((shot, index) => {
    const duration = durations[index];
    const start = round3(cursor);
    cursor = round3(cursor + duration);
    const preserveReference = Boolean(shot.preserveReferenceFrame || (!shot.videoUrl && !shot.imageUrl));
    const component = componentForShot.get(index);
    const generatedLayout = preserveReference ? undefined : shot.analysis?.layout;
    clips.push({
      id: `clone-video-${index}`,
      sourceClipId: `clone-video-${index}`,
      shotIndex: index,
      ...(component ? { componentId: component.id, role: component.role } : {}),
      track: 'video',
      // Graphic/transition shots reuse the original source video so their
      // card animation and timing survive the editable canvas handoff.
      type: preserveReference || shot.videoUrl ? 'video' : 'image',
      name: `镜头 ${index + 1}`,
      start,
      duration,
      sourceOffset: preserveReference ? shot.start : 0,
      fit: 'cover',
      ...transitionForShot(shot, index),
      ...motionPathForShot(shot),
      ...(generatedLayout ? { layout: generatedLayout } : {}),
    });
    videoTrack.clips.push({
      id: `clone-video-${index}`,
      shotIndex: index,
      ...(component ? { componentId: component.id, role: component.role } : {}),
      start,
      duration,
      source: preserveReference ? 'reference-video' : 'generated-media',
      mediaKind: preserveReference || shot.videoUrl ? 'video' : 'image',
      url: shot.videoUrl || shot.imageUrl,
      ...transitionForShot(shot, index),
      ...motionPathForShot(shot),
      ...(generatedLayout ? { layout: generatedLayout } : {}),
    });
    if (shot.audioUrl) {
      clips.push({
        id: `clone-audio-${index}`,
        sourceClipId: `clone-audio-${index}`,
        shotIndex: index,
        ...(component ? { componentId: component.id, role: component.role } : {}),
        track: 'audio',
        type: 'audio',
        name: `配音 ${index + 1}`,
        start,
        duration,
        sourceOffset: 0,
        volume: 1,
      });
      voiceTrack.clips.push({
        id: `clone-audio-${index}`,
        shotIndex: index,
        ...(component ? { componentId: component.id, role: component.role } : {}),
        start,
        duration,
        source: 'generated-media',
        url: shot.audioUrl,
        volume: 1,
      });
    }
    if (shot.line) {
      const words = captionWordsForShot(shot.line, shot, duration, transcript);
      clips.push({
        id: `clone-caption-${index}`,
        sourceClipId: `clone-caption-${index}`,
        shotIndex: index,
        track: 'caption',
        type: 'caption',
        name: `字幕 ${index + 1}`,
        start,
        duration,
        sourceOffset: 0,
        text: shot.line,
        words,
        fontSize: CLONE_CAPTION_FONT_SIZE,
        captionBackgroundOpacity: CLONE_CAPTION_BACKGROUND_OPACITY,
        textRole: 'caption',
      });
      captionTrack.clips.push({
        id: `clone-caption-${index}`,
        shotIndex: index,
        ...(component ? { componentId: component.id, role: component.role } : {}),
        start,
        duration,
        source: 'generated-media',
        text: shot.line,
        words,
      });
    }
    const graphicsText = shot.analysis?.graphicsText?.trim();
    if (graphicsText) {
      const graphicsClipId = `clone-graphics-${index}`;
      clips.push({
        id: graphicsClipId,
        sourceClipId: graphicsClipId,
        shotIndex: index,
        track: 'graphics',
        type: 'caption',
        name: `画面字卡 ${index + 1}`,
        start,
        duration,
        sourceOffset: 0,
        text: graphicsText,
        textRole: 'graphics',
        graphicsStyle: shot.analysis?.graphicsStyle,
        ...(shot.analysis?.graphicsBounds
          ? { textBox: shot.analysis.graphicsBounds }
          : captionTransformForPosition(shot.analysis?.graphicsPosition)),
        fontSize: CLONE_CAPTION_FONT_SIZE + 6,
        captionBackgroundOpacity: 0,
      });
      graphicsTrack.clips.push({
        id: graphicsClipId,
        shotIndex: index,
        ...(component ? { componentId: component.id, role: component.role } : {}),
        start,
        duration,
        source: 'generated-media',
        text: graphicsText,
        graphicsStyle: shot.analysis?.graphicsStyle,
        ...(shot.analysis?.graphicsBounds ? { textBox: shot.analysis.graphicsBounds } : {}),
      });
    }
  });
  // Keep the source ambience as one global A2 clip. The editor and final
  // mixer can then take any authored time window from the same continuous
  // track, instead of cutting and rejoining the original audio at every shot
  // boundary (which causes duplicated frames and audible seams after timing
  // edits or narration extensions).
  if (options.preserveReferenceAudio !== false && cursor > 0) {
    referenceAudioTrack.clips.push({
      id: 'clone-reference-audio-global',
      shotIndex: 0,
      start: 0,
      duration: round3(cursor),
      source: 'reference-video',
      sourceOffset: 0,
      volume: 0.35,
    });
  }
  return {
    duration: round3(cursor),
    fps: 30,
    aspect: options.aspect,
      clips,
    components,
    referenceAudioDucking: true,
    tracks: [videoTrack, referenceAudioTrack, voiceTrack, captionTrack, graphicsTrack].filter((track) => track.clips.length),
  };
}

/** 能力判断与降级说明：缺什么不静默，全部写进 warnings。 */
export function decideCapabilities(input: {
  hasVisionModel: boolean;
  hasSpeechModel: boolean;
  hasImageModel: boolean;
  hasVideoModel: boolean;
  hasReferenceImages?: boolean;
  hasReferenceVideo?: boolean;
  hasFirstFrame?: boolean;
  hasReferenceAudio?: boolean;
  /** 本机离线配音可用（Windows / macOS 自带语音合成），只在没有在线 TTS 模型时才兜底。 */
  offlineSpeech?: boolean;
}): { capabilities: CloneCapabilities; warnings: string[] } {
  const offlineSpeech = !input.hasSpeechModel && Boolean(input.offlineSpeech);
  const warnings: string[] = [];
  if (!input.hasVisionModel) warnings.push('没有声明「视觉」的对话模型：跳过画面拆解，按镜头数平均分配时长。');
  if (!input.hasSpeechModel && !offlineSpeech) warnings.push('没有可用的配音模型：本次成片为无声 + 字幕，时长按字数估算。');
  if (offlineSpeech) warnings.push('没有在线的配音模型：本次改用「本机离线配音」出声（免费、离线、不需联网，音色偏机械）。');
  if (!input.hasImageModel) warnings.push('没有可用的生图模型：普通镜头将保留参考帧静态降级；如需替换主体，请启用生图或图生视频模型。');
  if (!input.hasVideoModel) warnings.push('没有可用的视频模型：镜头改用静态图，成片仍然可以导出。');
  return {
    capabilities: {
      vision: input.hasVisionModel,
      speech: input.hasSpeechModel || offlineSpeech,
      offlineSpeech,
      image: input.hasImageModel,
      video: input.hasVideoModel,
      referenceImages: Boolean(input.hasReferenceImages),
      ...(input.hasReferenceVideo ? { referenceVideo: true } : {}),
      firstFrame: Boolean(input.hasFirstFrame),
      referenceAudio: Boolean(input.hasReferenceAudio),
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

/**
 * Parse the timestamps emitted by FFmpeg's `select=gt(scene,...)`,showinfo
 * filter. Keeping this parser pure makes the scene-cut contract testable
 * without starting a media process and keeps provider/network code out of the
 * planning layer.
 */
export function parseSceneChangeTimes(stderr: unknown, durationSeconds = Number.POSITIVE_INFINITY, maxChanges = 64) {
  const duration = Number(durationSeconds);
  const limit = Math.max(0, Math.round(Number(maxChanges) || 0));
  if (!limit) return [];
  const seen = new Set<number>();
  for (const match of String(stderr ?? '').matchAll(/\bpts_time:([0-9]+(?:\.\d+)?)/g)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (Number.isFinite(duration) && value >= duration) continue;
    seen.add(round3(value));
  }
  return [...seen].sort((left, right) => left - right).slice(0, limit);
}

/**
 * 任务心跳超时：管线在等服务商出片（单个镜头最长等 10 分钟）时每 60 秒续一次心跳，
 * 所以「这么久没有任何更新」只可能是执行进程已经没了（应用重启、进程被杀、机器休眠后进程消失）。
 */
export const CLONE_STALE_JOB_MS = 10 * 60 * 1000;

export function isCloneJobStale(job: { stage: CloneStage; updatedAt?: string }, now = Date.now()) {
  if (job.stage === 'done' || job.stage === 'failed' || job.stage === 'cancelled' || job.stage === 'planned') return false;
  const stamp = Date.parse(job.updatedAt || '');
  return Number.isFinite(stamp) && now - stamp > CLONE_STALE_JOB_MS;
}

const STAGE_PROGRESS: Record<CloneStage, number> = {
  queued: 0,
  analyzing: 0.08,
  scripting: 0.2,
  planned: 0.34,
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
  if (stage === 'planned') return '镜头计划已生成，等待确认';
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

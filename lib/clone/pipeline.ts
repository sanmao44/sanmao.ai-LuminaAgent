/**
 * 「一键克隆出片」的编排管线。
 *
 * 流程：抽帧 → 视觉模型拆镜头 → 重写文案 → 逐句 TTS → 逐镜头生图 → 逐镜头生视频
 *      → 按「配音时长」而不是参考视频时长排时间轴。
 *
 * 四条降级链都不静默：全部落到 job.warnings 或 shot.error。
 *   · 没有视觉模型  → 按镜头数平均分配时长，但仍抽取参考帧用于本地化降级
 *   · 没有对话模型  → 没有口播文案：成片只有画面，没有配音与字幕
 *   · 没有 TTS 模型 → 没有在线 TTS 时，Windows / macOS 用系统自带语音合成兜底（离线免费）；
 *                    其它平台（含无法启动系统语音时）无声成片，时长按字数估算
 *   · 没有生图/视频或生成失败  → 普通镜头退回参考帧，卡片/转场保留原片动态
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';
import { getDefaultAudioStoragePath, persistAudioBuffer } from '../audio-storage';
import { persistGeneratedImages, persistImageBuffer, resolveStoredFileWithFallback } from '../image-storage';
import { chatCompletion, editImage, generateImage, imageDownloadAuth, type ChatContentPart, type ChatMessage } from '../providers';
import { getPublicState, getRuntimeImageGenerationModel, getRuntimeVideoModel, getRuntimeVisionModel } from '../store';
import type { VideoGenerationInput } from '../types';
import { getPublicMediaTransportStatusLive } from '../signed-media';
import { persistVideoBuffer, resolveStoredVideoFileWithFallback } from '../video-storage';
import { getVideoModelLimits } from '../video-model-limits';
import { requiresPublicMediaRelay } from '../video-platform';
import { createVideoGeneration, refreshVideoTask } from '../video-task-service';
import { askText, chatText, parseJsonBlock } from './chat';
import { detectSceneChanges, extractFrameFiles, extractReferenceAudioTrack, extractVideoSegment, probeMediaSeconds } from './media';
import { transcribeReferenceAudio } from './asr';
import { localOcrAvailable, mergeOcrText, ocrImageFile, ocrPosition } from './ocr';
import { alignShotsWithLines, buildBlueprintComponents, buildBlueprintVariantPlan, buildTimeline, clampShotSeconds, cloneShotDirection, cloneStageProgress, isCloneJobStale, normalizeShots, referenceFrameSampleTimes, round3, shouldPreserveReferenceFrameAnalysis, shotsFromSceneChanges, snapShotBoundariesToSceneChanges, splitLines, type NormalizedShot } from './plan';
import { offlineSpeechSupported, synthesizeOfflineSpeech } from './offline-speech';
import { audioExtension, resolveSpeechRuntime, synthesizeSpeech } from './speech';
import { assembleCloneVideo } from './assemble';
import { findCloneJob, listCloneJobs, touchCloneJob, updateCloneJob } from './store';
import type { CloneAsset, CloneBlueprintVariantPlan, CloneBlueprintVariantSpec, CloneJob, CloneOcrObservation, CloneReferenceAnalysis, CloneReferenceOcrFrame, CloneShot, CloneShotAnalysis, CloneShotSpeechMode, CloneTimeline, CloneTranscript, CloneVisualBible } from './types';
import { normalizeVideoEditorState } from '../canvas/video-editor';
import type { CanvasVideoEditorState } from '../canvas/types';

const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;
// 等服务商出片时定期续心跳：前端靠 updatedAt 判断这条任务是真的在跑，还是执行进程已经没了。
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const CLONE_INTERRUPTED_MESSAGE = '任务中断：没有等到服务商返回（通常是应用重启或长时间无响应）。点「继续任务」接着跑，已经生成好的配音和镜头不会重做。';
const VIDEO_POLL_INTERVAL_MS = 2000;
const MAX_REFERENCE_BYTES = 512 * 1024 * 1024;
const IMAGE_CONCURRENCY = 2;
// 视频逐镜串行提交：Agnes 这类服务商对并发/频率卡得很死（约每分钟 1 条、队列只放 1 条），
// 并发提交只会换来 429 和「队列已满」，单个镜头白跑一轮。
const VIDEO_CONCURRENCY = 1;
// 命中限流/队列已满时按服务商节奏等一等再试，不做短退避轰炸。
const VIDEO_RETRY_WAITS_MS = [30_000, 60_000];

const ANALYZE_SYSTEM = '你是短视频导演。只输出 JSON，不要输出解释、Markdown 或多余文字。';
const SCRIPT_SYSTEM = '你是短视频编剧。只输出 JSON，不要输出解释、Markdown 或多余文字。';

type ChatRuntime = Awaited<ReturnType<typeof getRuntimeVisionModel>>;
type ImageRuntime = Awaited<ReturnType<typeof getRuntimeImageGenerationModel>>;
type VideoRuntime = Awaited<ReturnType<typeof getRuntimeVideoModel>>;
type SpeechRuntime = NonNullable<Awaited<ReturnType<typeof resolveSpeechRuntime>>>;

function capabilitiesForExecution(
  chatRuntime: ChatRuntime,
  imageRuntime: ImageRuntime,
  videoRuntime: VideoRuntime,
  speechRuntime: SpeechRuntime | null,
): CloneJob['capabilities'] {
  const videoLimits = videoRuntime ? getVideoModelLimits(videoRuntime.model, videoRuntime.provider) : null;
  return {
    vision: Boolean(chatRuntime?.model.capabilities.includes('vision')),
    speech: Boolean(speechRuntime) || offlineSpeechSupported(),
    offlineSpeech: offlineSpeechSupported(),
    image: Boolean(imageRuntime),
    video: Boolean(videoRuntime),
    referenceImages: Boolean(videoRuntime?.model.capabilities.includes('video-reference')),
    referenceVideo: Boolean(
      videoRuntime?.model.capabilities.includes('video-reference')
      && videoLimits
      && videoLimits.maxReferenceVideos > 0,
    ),
    firstFrame: Boolean(videoRuntime?.model.capabilities.includes('video-first-frame')),
    referenceAudio: Boolean(
      videoRuntime?.model.capabilities.includes('video-audio')
      && videoLimits
      && videoLimits.maxAudios > 0,
    ),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cloneJobDirectory(id: string) {
  return path.join(resolveLocalDataDir(), 'clone-jobs', id);
}

/**
 * 成片已经落到正式存储（图片 / 音频 / 视频各走各的存储），任务目录里的参考视频副本、
 * 抽帧和配音探测文件就没有保留价值了。不清理的话每跑一条任务就多留一份参考视频。
 * 只在 done 之后调用；删除前确认目标确实在 clone-jobs 目录里。
 */
export async function cleanupCloneJobDirectory(id: string) {
  const root = path.join(resolveLocalDataDir(), 'clone-jobs');
  const directory = cloneJobDirectory(id);
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  if (!items.length) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function replaceShot(shots: CloneShot[], index: number, patch: Partial<CloneShot>) {
  return shots.map((shot, position) => (position === index ? { ...shot, ...patch } : shot));
}

/**
 * Ordinary shots must not silently fall back to the original moving clip when
 * generation fails. The representative frame is the deterministic local
 * fallback; only shots explicitly marked as reference-preserved may reuse the
 * original video segment.
 */
function fallbackShotToReferenceFrame(shot: CloneShot): CloneShot {
  return shot.preserveReferenceFrame || shot.videoUrl || shot.imageUrl || !shot.referenceFrameUrl
    ? shot
    : { ...shot, imageUrl: shot.referenceFrameUrl, status: 'done' };
}

/**
 * 取用户在弹窗高级设置里显式选的模型：选了但已经不可用（被停用/删除）时退回自动选择，
 * 并把原因写成任务提示，不让整条管线莫名其妙地失败。
 */
async function resolveSelectedModel<T>(id: string | undefined, label: string, resolve: (id: string | null) => Promise<T | null>) {
  const explicit = String(id || '').trim();
  if (!explicit || explicit === 'auto') return { value: await resolve(null), warning: '' };
  const picked = await resolve(explicit);
  if (picked) return { value: picked, warning: '' };
  return { value: await resolve(null), warning: `${label}「${explicit}」当前不可用（可能已停用或删除），已自动改用其他可用模型。` };
}

/** 追加任务级提示（去重后落库），返回合并后的提示列表。 */
async function appendWarnings(id: string, additions: readonly string[]) {
  const list = additions.map((item) => String(item || '').trim()).filter(Boolean);
  if (!list.length) return [];
  const job = await findCloneJob(id);
  const warnings = mergeWarnings(job?.warnings || [], list);
  await patchJob(id, { warnings });
  return warnings;
}

/** 限流、队列已满这类错误等一会儿是真的会好，其余错误直接降级不退避。 */
function isTransientVideoError(message: string) {
  return /429|限流|队列已满|queue is full|rate limit|too many requests|稍后再试|稍后重试/i.test(message);
}

function mergeWarnings(existing: readonly string[] = [], incoming: readonly string[] = []) {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter((item) => {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

async function isCancelled(id: string) {
  const job = await findCloneJob(id);
  return !job || Boolean(job.cancelRequested);
}

async function patchJob(id: string, patch: Partial<CloneJob>) {
  return updateCloneJob(id, patch);
}

/**
 * 取消收尾：标记已取消，并清掉本任务目录。
 * 任务记录可能已经被「删除任务」删掉了（patchJob 这时返回 null），目录同样要清：
 * 里面只有参考视频副本、抽帧和配音探测文件，留下就是一份白占空间的残留。
 */
async function finishCancelled(id: string) {
  const job = await patchJob(id, { stage: 'cancelled', message: '已取消', finishedAt: new Date().toISOString() });
  await cleanupCloneJobDirectory(id);
  return job;
}

/** 把画布里的参考视频落到本地文件：ffmpeg 只认路径。 */
async function materializeReference(job: CloneJob) {
  const directory = cloneJobDirectory(job.id);
  await mkdir(directory, { recursive: true });
  const url = String(job.reference.url || '');
  const state = await getPublicState();
  if (url.startsWith('/api/storage/video')) {
    const name = new URL(url, 'http://localhost').searchParams.get('name') || '';
    // 必须和 /api/storage/video 用同一套解析（主目录找不到就回退历史目录）：
    // 用严格路径的话，换过运行目录或旧版本存的素材会解析成一个不存在的文件，
    // 最后只报一句「没抽到画面」，用户根本不知道是怎么回事。
    const file = resolveStoredVideoFileWithFallback(state.settings.videoStoragePath || '', name);
    if (!file || !existsSync(file)) throw new Error('参考视频已不在本地存储里，请重新导入后再试。');
    return file;
  }
  if (url.startsWith('/api/storage/file')) {
    const name = new URL(url, 'http://localhost').searchParams.get('name') || '';
    const file = resolveStoredFileWithFallback(state.settings.imageStoragePath || '', name);
    if (!file) throw new Error('参考视频已不在本地存储里，请重新导入后再试。');
    return file;
  }
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`下载参考视频失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error('下载到的参考视频是空文件。');
    if (buffer.byteLength > MAX_REFERENCE_BYTES) throw new Error('参考视频超过 512MB，请先裁剪后再用。');
    const extension = path.extname(new URL(url).pathname) || '.mp4';
    const file = path.join(directory, `reference${extension}`);
    await writeFile(file, buffer);
    return file;
  }
  throw new Error('参考视频必须是画布中已导入的视频素材。');
}

/**
 * Keep each source shot's real motion as a reusable local Blueprint asset.
 * Generation providers still receive an inline data URL, but rerenders and
 * variants no longer need to cut the same window out of the full reference
 * video again.
 */
async function ensureReferenceVideoUrl(job: CloneJob, shot: CloneShot, referenceFile: string) {
  if (shot.referenceVideoUrl) return shot;
  const state = await getPublicState();
  const directory = path.join(cloneJobDirectory(job.id), 'reference-segments');
  await mkdir(directory, { recursive: true });
  const segmentFile = path.join(directory, `shot-${String(shot.index).padStart(3, '0')}.mp4`);
  try {
    if (!existsSync(segmentFile)) await extractVideoSegment(referenceFile, shot.start, shot.end, segmentFile);
    const stored = await persistVideoBuffer(await readFile(segmentFile), 'video/mp4', state.settings.videoStoragePath || '');
    return { ...shot, referenceVideoUrl: stored.url };
  } catch {
    // Persistence is a reuse optimization; the on-demand path remains valid.
    return shot;
  }
}

async function referenceVideoDataUrl(value: string | undefined) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (source.startsWith('data:video/')) return source;
  const state = await getPublicState();
  let file: string | null = null;
  if (source.startsWith('/api/storage/video')) {
    const name = new URL(source, 'http://localhost').searchParams.get('name') || '';
    file = resolveStoredVideoFileWithFallback(state.settings.videoStoragePath || '', name);
  } else if (/^https?:\/\//iu.test(source)) {
    const response = await fetch(source, { cache: 'no-store', signal: AbortSignal.timeout(120_000) });
    const length = Number(response.headers.get('content-length') || 0);
    if (response.ok && length <= MAX_REFERENCE_BYTES) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength <= MAX_REFERENCE_BYTES) return `data:${response.headers.get('content-type') || 'video/mp4'};base64,${buffer.toString('base64')}`;
    }
  }
  if (!file || !existsSync(file)) return null;
  return `data:video/mp4;base64,${(await readFile(file)).toString('base64')}`;
}

async function frameDataUrls(files: string[]) {
  const urls: string[] = [];
  for (const file of files) {
    try {
      urls.push(`data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`);
    } catch {
      // 单帧读不到就跳过，不打断拆解。
    }
  }
  return urls;
}

function buildReferenceAnalysis(
  duration: number,
  frames: { files: string[]; times?: number[] },
  shots: readonly Pick<CloneShot, 'index' | 'start' | 'end' | 'analysis'>[],
  method: CloneReferenceAnalysis['method'],
  sceneChangeTimes: number[] = [],
  transcript?: CloneTranscript | null,
  ocr?: CloneReferenceOcrFrame[],
  visualBible?: CloneVisualBible,
): CloneReferenceAnalysis {
  return {
    version: 1,
    duration: round3(duration),
    sampleTimes: (frames.times || []).map(round3),
    ...(sceneChangeTimes.length ? { sceneChangeTimes: sceneChangeTimes.map(round3) } : {}),
    method,
    ...(transcript?.text ? { transcript: transcript.text, transcriptData: transcript } : {}),
    ...(ocr?.length ? { ocr } : {}),
    ...(visualBible && Object.keys(visualBible).length ? { visualBible } : {}),
    shots: shots.map((shot, index) => ({
      index: Number.isInteger(shot.index) ? shot.index : index,
      start: round3(shot.start),
      end: round3(shot.end),
      ...(shot.analysis ? { analysis: shot.analysis } : {}),
    })),
  };
}

function visualBiblePrompt(visualBible?: CloneVisualBible) {
  if (!visualBible) return '';
  const parts = [
    visualBible.subjectIdentity ? `全片主体身份与外观统一：${visualBible.subjectIdentity}` : '',
    visualBible.productIdentity ? `全片产品/包装统一：${visualBible.productIdentity}` : '',
    visualBible.brandLanguage ? `品牌语言统一：${visualBible.brandLanguage}` : '',
    visualBible.visualStyle ? `全片视觉风格统一：${visualBible.visualStyle}` : '',
    visualBible.palette ? `全片色彩/材质统一：${visualBible.palette}` : '',
    visualBible.lighting ? `全片光线统一：${visualBible.lighting}` : '',
    visualBible.cameraGrammar ? `全片摄影语法统一：${visualBible.cameraGrammar}` : '',
    visualBible.continuityRules ? `跨镜头连续性规则：${visualBible.continuityRules}` : '',
    visualBible.negativeConstraints ? `全片禁止项：${visualBible.negativeConstraints}` : '',
  ].filter(Boolean);
  return parts.length ? `；${parts.join('；')}` : '';
}

const VISUAL_BIBLE_KEYS = [
  'subjectIdentity', 'productIdentity', 'brandLanguage', 'visualStyle', 'palette',
  'lighting', 'cameraGrammar', 'continuityRules', 'negativeConstraints',
] as const;

function normalizeVisualBible(value: unknown): CloneVisualBible | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const bible = Object.fromEntries(VISUAL_BIBLE_KEYS
    .map((key) => [key, typeof source[key] === 'string' ? source[key].replace(/\s+/gu, ' ').trim().slice(0, 360) : ''])
    .filter(([, item]) => Boolean(item))) as CloneVisualBible;
  return Object.keys(bible).length ? bible : undefined;
}

/** Fill the global grammar from structured shot analysis when the model omits it. */
function deriveVisualBible(shots: readonly Pick<CloneShot, 'analysis'>[], existing?: CloneVisualBible) {
  const values = (key: keyof CloneShotAnalysis) => [...new Set(shots.map((shot) => shot.analysis?.[key]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))].slice(0, 3).join('；');
  return normalizeVisualBible({
    ...existing,
    visualStyle: existing?.visualStyle || values('visualStyle'),
    cameraGrammar: existing?.cameraGrammar || values('camera'),
    continuityRules: existing?.continuityRules || '保持同一主体/产品身份、服装材质、画面色彩与镜头运动逻辑；只替换明确要求改变的内容。',
    negativeConstraints: existing?.negativeConstraints || '不要改变主体身份、产品包装结构、品牌标记位置；不要生成额外字幕、水印或无关人物。',
  });
}

async function analyzeVisualBible(runtime: ChatRuntime | null, images: string[], shots: readonly Pick<CloneShot, 'analysis'>[], job: CloneJob) {
  const fallback = deriveVisualBible(shots);
  if (!runtime || !images.length) return fallback;
  try {
    const response = await chatCompletion(runtime.provider, runtime.model.rawId, {
      messages: [
        { role: 'system', content: ANALYZE_SYSTEM },
        { role: 'user', content: [
          { type: 'text', text: `请从这组按时间顺序抽取的参考视频帧中建立一份跨镜头视觉圣经。它不是分镜描述，而是供后续逐镜生成复用的身份、产品、品牌、色彩、光线、摄影语法与连续性约束。用户主题：${job.options.brief || '保持参考视频结构并本地化内容'}。只输出 JSON：{"visualBible":{"subjectIdentity":"","productIdentity":"","brandLanguage":"","visualStyle":"","palette":"","lighting":"","cameraGrammar":"","continuityRules":"","negativeConstraints":""}}。看不清的字段留空，不要猜测具体人名、品牌名或文字。` },
          ...images.slice(0, 12).map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ] },
      ],
    });
    const payload = parseJsonBlock(chatText(response));
    const parsed = payload && typeof payload === 'object' && 'visualBible' in payload ? (payload as { visualBible?: unknown }).visualBible : payload;
    return deriveVisualBible(shots, normalizeVisualBible(parsed) || fallback);
  } catch {
    return fallback;
  }
}

async function analyzeReferenceOcr(frames: { files: string[]; times?: number[] }) {
  const output: CloneReferenceOcrFrame[] = [];
  for (const [index, file] of frames.files.entries()) {
    const result = await ocrImageFile(file).catch(() => null);
    if (!result?.observations.length) continue;
    output.push({
      time: round3(frames.times?.[index] || 0),
      observations: result.observations,
    });
  }
  return output;
}

function ocrForShot(ocr: readonly CloneReferenceOcrFrame[], start: number, end: number) {
  return ocr
    .filter((frame) => frame.time >= start && frame.time <= end)
    .flatMap((frame) => frame.observations)
    .filter((observation) => observation.text.trim());
}

function unionOcrBounds(observations: readonly CloneOcrObservation[]) {
  const boxes = observations.map((observation) => observation.bounds).filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds));
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(0.01, right - left), height: Math.max(0.01, bottom - top) };
}

function enrichShotsFromOcr(shots: NormalizedShot[], ocr: readonly CloneReferenceOcrFrame[]) {
  return shots.map((shot) => {
    const observations = ocrForShot(ocr, shot.start, shot.end);
    if (!observations.length) return shot;
    const text = mergeOcrText(observations);
    const bounds = unionOcrBounds(observations);
    const analysis = shot.analysis || {};
    return {
      ...shot,
      analysis: {
        ...analysis,
        ...(analysis.graphicsText || !text ? {} : { graphicsText: text }),
        ...(analysis.graphicsPosition || !bounds ? {} : { graphicsPosition: ocrPosition(bounds) }),
        ...(analysis.graphicsBounds || !bounds ? {} : { graphicsBounds: bounds }),
        ...(analysis.graphics || !text ? {} : { graphics: `本地 OCR 识别到画面文字：${text}` }),
        ...(analysis.role || !text ? {} : { role: 'graphic' as const }),
      },
    };
  });
}

function transcriptForShot(transcript: CloneTranscript | null | undefined, start: number, end: number) {
  if (!transcript?.segments.length) return '';
  const selected = transcript.segments.filter((segment) => segment.end > start && segment.start < end);
  return selected.map((segment) => segment.text).join(' ').replace(/\s+/gu, ' ').trim();
}

async function loadReferenceTranscript(id: string, referenceFile: string, duration: number) {
  await patchJob(id, { message: '正在本地分析参考音频（首次运行可能需要准备 ASR 模型）' });
  const heartbeat = setInterval(() => { void touchCloneJob(id); }, HEARTBEAT_INTERVAL_MS);
  try {
    return await transcribeReferenceAudio(
      referenceFile,
      path.join(cloneJobDirectory(id), 'reference-audio.wav'),
      duration,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

function shouldPreserveReferenceFrame(shot: Pick<CloneShot, 'analysis'>) {
  return shouldPreserveReferenceFrameAnalysis(shot.analysis);
}

async function materializeReferenceAudioTrack(
  referenceFile: string,
  timeline: CloneTimeline,
  workingDirectory: string,
) {
  const track = timeline.tracks?.find((item) => item.kind === 'reference-audio');
  if (!track?.clips.length) return timeline;
  const sourceFile = path.join(workingDirectory, 'reference-audio-track.m4a');
  const extracted = await extractReferenceAudioTrack(referenceFile, sourceFile).catch(() => null);
  if (!extracted) return timeline;
  const stored = await persistAudioBuffer(await readFile(extracted), 'audio/mp4');
  return {
    ...timeline,
    tracks: timeline.tracks?.map((item) => item.kind === 'reference-audio'
      ? { ...item, clips: item.clips.map((clip) => ({ ...clip, url: stored.url, sourceOffset: clip.sourceOffset ?? clip.start })) }
      : item),
  };
}

function timelineWithEditorState(base: CloneTimeline, editorState: CanvasVideoEditorState): CloneTimeline {
  return {
    ...base,
    duration: editorState.projectDuration,
    fps: editorState.fps,
    aspect: editorState.aspect,
    clips: editorState.clips,
    editorState,
    referenceAudioDucking: editorState.referenceAudioDucking ?? base.referenceAudioDucking,
  };
}

async function attachReferenceFrames(shots: CloneShot[], frames: { files: string[]; times?: number[] }) {
  if (!frames.files.length) return shots;
  const state = await getPublicState();
  const cache = new Map<number, string>();
  const times = frames.times || [];
  const frameFor = (shot: CloneShot) => {
    const midpoint = (shot.start + shot.end) / 2;
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    times.forEach((time, index) => {
      const next = Math.abs(time - midpoint);
      if (next < distance) {
        distance = next;
        best = index;
      }
    });
    return Math.min(best, frames.files.length - 1);
  };
  return Promise.all(shots.map(async (shot) => {
    const index = frameFor(shot);
    if (shot.referenceFrameUrl || cache.has(index)) return {
      ...shot,
      ...(cache.has(index) ? { referenceFrameUrl: cache.get(index) } : {}),
      ...(shouldPreserveReferenceFrame(shot) ? { preserveReferenceFrame: true } : {}),
    };
    try {
      const stored = await persistImageBuffer(await readFile(frames.files[index]), 'image/jpeg', state.settings.imageStoragePath || '');
      cache.set(index, stored.url);
      return { ...shot, referenceFrameUrl: stored.url, ...(shouldPreserveReferenceFrame(shot) ? { preserveReferenceFrame: true } : {}) };
    } catch {
      return shouldPreserveReferenceFrame(shot) ? { ...shot, preserveReferenceFrame: true } : shot;
    }
  }));
}

/** 视觉拆解：没有视觉模型或拆解失败时退回等间隔切分，并把降级原因写进 warning。 */
async function analyzeShots(runtime: ChatRuntime, frames: { files: string[]; error: string; times?: number[]; sceneChangeTimes?: number[] }, job: CloneJob, durationSeconds: number): Promise<{ shots: NormalizedShot[]; warning?: string }> {
  const equalShots = () => frames.sceneChangeTimes?.length
    ? shotsFromSceneChanges(durationSeconds, frames.sceneChangeTimes, job.options.maxShots)
    : normalizeShots(null, { durationSeconds, maxShots: job.options.maxShots });
  // 创建任务时已经就「没有视觉模型」给过全局提示，这里不再重复。
  if (!job.capabilities.vision) return { shots: equalShots() };
  if (!runtime) return { shots: equalShots(), warning: '视觉对话模型已不可用：跳过画面拆解，按镜头数平均分配时长。' };
  const images = await frameDataUrls(frames.files);
  if (!images.length) {
    // 把真实原因带出去（ffmpeg 报错 / 读不出帧），不然用户只看到「没拆解」，无从下手。
    const reason = frames.error || (frames.files.length ? '抽出来的帧读不出来' : '没有抽到帧');
    return { shots: equalShots(), warning: `参考视频拆解不了（${reason}）：跳过画面拆解，按镜头数平均分配时长。` };
  }
  const frameGuide = frames.files.map((_, index) => `${index + 1}. t=${round3(frames.times?.[index] || 0)}s`).join('\n');
  const sceneGuide = frames.sceneChangeTimes?.length
    ? `本地 FFmpeg 检测到的硬切候选时间点：${frames.sceneChangeTimes.map(round3).join('、')} 秒。镜头边界优先贴近这些时间点。`
    : '本地没有检测到明确硬切，仍请根据抽帧和画面变化判断镜头边界。';
  const instruction = [
    `这是一条 ${round3(durationSeconds)} 秒参考视频按时间顺序抽取的画面。`,
    `抽帧时间标签如下：\n${frameGuide}`,
    sceneGuide,
    '如果画面包含标题、Logo、价格、按钮或字幕，请优先逐字抄录，不要只写“有文字”；能判断位置和样式时一并写入 graphicsPosition、graphicsStyle、graphicsBounds（归一化 x/y/width/height，左上角为 0,0）。',
    `请把它拆成不超过 ${job.options.maxShots} 个镜头，每个镜头给出：起止秒数（0 到 ${round3(durationSeconds)}，不能重叠）、画面内容描述、用于重新生成同类画面的中文提示词，以及结构化参考分析。`,
    'analysis 尽量包含 camera、composition、motion、motionPath、visualStyle、graphics、graphicsText（尽量逐字抄录画面文字）、graphicsPosition、graphicsStyle、graphicsBounds、layout、audio、transition、transitionType、transitionDuration、role；layout 只有在画面确实存在明确分栏、画中画或卡片容器时才填写，mode 只能是 full|split-horizontal|split-vertical|picture-in-picture|card，并用归一化 primary/secondary 区域描述主体位置；transitionType 只能是 cut|fade|dissolve|wipe|slide|none，role 只能是 performance|broll|graphic|transition|product|other。',
    '只输出 JSON：{"shots":[{"start":0,"end":3,"visual":"画面描述","prompt":"提示词","analysis":{"camera":"...","composition":"...","motion":"...","motionPath":"...","visualStyle":"...","graphics":"...","graphicsText":"...","graphicsPosition":"bottom-center","graphicsStyle":"...","graphicsBounds":{"x":0.1,"y":0.1,"width":0.8,"height":0.12},"layout":{"mode":"card","backgroundColor":"#101014","surfaceColor":"#26262d","padding":0.06,"radius":0.06,"primary":{"x":0.06,"y":0.06,"width":0.88,"height":0.88,"radius":0.06}},"audio":"...","transition":"...","transitionType":"cut","transitionDuration":0,"role":"performance"}}]}',
  ].join('\n');
  const content: ChatContentPart[] = [
    { type: 'text', text: instruction },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
  const messages: ChatMessage[] = [{ role: 'system', content: ANALYZE_SYSTEM }, { role: 'user', content }];
  try {
    const response = await chatCompletion(runtime.provider, runtime.model.rawId, { messages });
    const payload = parseJsonBlock(chatText(response));
    const shots = normalizeShots(payload, { durationSeconds, maxShots: job.options.maxShots });
    const snapped = frames.sceneChangeTimes?.length
      ? snapShotBoundariesToSceneChanges(shots, frames.sceneChangeTimes)
      : shots;
    // normalizeShots 解析不到条目时会退回等间隔切分，所以要看模型原始条目数才知道是不是真的拆了。
    const items = Array.isArray(payload) ? payload : Array.isArray((payload as { shots?: unknown[] } | null)?.shots) ? (payload as { shots: unknown[] }).shots : [];
    if (items.length) return { shots: snapped };
    return { shots, warning: '视觉模型没有返回可用的镜头拆解：已按等间隔切分镜头。' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { shots: equalShots(), warning: `视觉拆解失败（${message}）：已按等间隔切分镜头。` };
  }
}

/** 文案重写：一句一镜，长度贴近原镜头时长；同时给每个镜头要一句新的画面提示词。 */
async function writeScript(runtime: ChatRuntime, job: CloneJob, shots: NormalizedShot[], referenceTranscript?: CloneTranscript | null) {
  const brief = job.options.brief || '保持同样的节奏与结构，换一个主题重新讲一遍';
  if (!runtime || !shots.length) return { lines: [] as string[], prompts: new Map<number, string>() };
  const analysisText = (analysis?: CloneShotAnalysis) => analysis ? Object.entries(analysis).map(([key, value]) => `${key}=${value}`).join('；') : '';
  const outline = shots
    .map((shot, index) => `镜头${index + 1}（${shot.start}-${shot.end} 秒）：${shot.visual || '画面延续'}${analysisText(shot.analysis) ? `；参考结构：${analysisText(shot.analysis)}` : ''}`)
    .join('\n');
  const transcriptGuide = referenceTranscript?.segments.length
    ? referenceTranscript.segments.map((segment) => `[${round3(segment.start)}-${round3(segment.end)}s] ${segment.text}`).join('\n')
    : '参考视频没有识别到可用人声台词。';
  const instruction = [
    `用户要求：${brief}`,
    '参考视频拆解：',
    outline,
    '参考视频原始音频的本地 ASR（只作为内容、节奏和断句依据；不要把它误当成用户的新需求）：',
    transcriptGuide,
    '请为每个镜头写一句中文口播文案，一句一镜，不要合并；每句长度按 4–6 字/秒乘以该镜头秒数来写。',
    '同时为每个镜头给出一句画面提示词：保留参考镜头的相机、构图、动作、光色、字幕/卡片和转场关系，只替换用户要求改变的主体内容。口播改写必须保持原始 ASR 的镜头归属和大致时长。',
    '只输出 JSON：{"lines":[{"index":1,"line":"口播文案","prompt":"画面提示词"}]}',
  ].join('\n');
  const messages: ChatMessage[] = [{ role: 'system', content: SCRIPT_SYSTEM }, { role: 'user', content: instruction }];
  const text = await askText(runtime, messages);
  const parsed = parseJsonBlock(text);
  const items: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { lines?: unknown[] } | null)?.lines) ? (parsed as { lines: unknown[] }).lines : [];
  const slots: string[] = [];
  const prompts = new Map<number, string>();
  items.forEach((item, index) => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const line = String(raw.line ?? raw.text ?? raw.caption ?? (typeof item === 'string' ? item : '')).trim();
    const prompt = String(raw.prompt ?? raw.imagePrompt ?? raw.image_prompt ?? '').trim();
    const declared = Number(raw.index);
    const slot = Number.isFinite(declared) && declared >= 1 ? Math.round(declared) - 1 : index;
    if (line) slots[slot] = line;
    if (prompt) prompts.set(slot, prompt);
  });
  return { lines: slots.filter((line) => Boolean(line)), prompts };
}

async function voiceShot(runtime: SpeechRuntime | null, job: CloneJob, shot: CloneShot, index: number) {
  // 在线 TTS 走服务商；一个在线模型都没有时，用系统自带语音合成（Windows / macOS）。
  const audio = runtime
    ? await synthesizeSpeech(runtime, { text: shot.line, voice: job.options.voice })
    : await synthesizeOfflineSpeech(shot.line, { voice: job.options.voice });
  const directory = cloneJobDirectory(job.id);
  await mkdir(directory, { recursive: true });
  // 探测用的临时文件必须带对扩展名：Gitee 这类服务商忽略 response_format 直接回 wav，
  // 写死 .mp3 会让 ffmpeg 的时长探测在部分平台上失败。
  const probeFile = path.join(directory, `voice-${index}.${audioExtension(audio.contentType)}`);
  await writeFile(probeFile, audio.buffer);
  const seconds = await probeMediaSeconds(probeFile).catch(() => null);
  const stored = await persistAudioBuffer(audio.buffer, audio.contentType);
  return { url: stored.url, seconds: seconds && seconds > 0 ? round3(seconds) : undefined, voice: audio.voice };
}

async function generateShotImage(
  runtime: ImageRuntime,
  job: CloneJob,
  shot: CloneShot,
  options: { forceRegenerate?: boolean } = {},
) {
  if (!options.forceRegenerate && shot.preserveReferenceFrame && shot.referenceFrameUrl) return shot.referenceFrameUrl;
  if (!runtime) return shot.referenceFrameUrl || null;
  // A generation-only image model cannot accept the recovered frame. Keeping
  // that frame is a better local fallback during the base run. An explicit
  // Blueprint variant is different: it must either generate new pixels or
  // fail clearly, never report success while silently reusing the old frame.
  if (shot.referenceFrameUrl && !runtime.model.capabilities.includes('edit') && !options.forceRegenerate) return shot.referenceFrameUrl;
  const state = await getPublicState();
  const prompt = `${cloneShotDirection(shot, job.options.brief)}${visualBiblePrompt(job.blueprint?.visualBible || job.referenceAnalysis?.visualBible)}；画面真实自然，不要出现文字水印`;
  const canEdit = runtime.model.capabilities.includes('edit');
  const references = canEdit && shot.referenceFrameUrl
    ? await cloneImageReferences(job, shot)
    : canEdit && shot.strategy !== 'text'
      ? await cloneImageReferences(job, shot)
      : [];
  const images = references.length
    ? await editImage(runtime.provider, runtime.model.rawId, {
      prompt: `${prompt}。请严格保持本镜头参考素材中的${(job.assets || []).filter((asset) => asset.kind === 'image' && (shot.assetIds || []).includes(asset.nodeId || asset.url)).map((asset) => asset.role).join('、')}身份与外观。`,
      references,
      aspectRatio: job.options.aspect,
      count: 1,
      responseFormat: 'url',
      fidelity: 'high',
    })
    : await generateImage(runtime.provider, runtime.model.rawId, {
      prompt,
      aspectRatio: job.options.aspect,
      count: 1,
      responseFormat: 'url',
    });
  if (!images.length) throw new Error('生图接口没有返回图片。');
  const stored = await persistGeneratedImages(images, state.settings.imageStoragePath || '', imageDownloadAuth(runtime.provider));
  const url = stored.images[0]?.url;
  if (!url) throw new Error('生图结果没有落地到本地存储。');
  return url;
}

/**
 * Complete only the media explicitly marked by a Blueprint variant. The base
 * job remains immutable; the returned shot array is the variant's private
 * working copy. This keeps a changed prompt from accidentally reusing the old
 * image/video while unaffected shots still point at their persisted media.
 */
async function renderVariantMedia(
  job: CloneJob,
  shots: CloneShot[],
  indexes: readonly number[],
  referenceFile: string,
  imageRuntime: ImageRuntime,
  videoRuntime: VideoRuntime,
) {
  if (!indexes.length) return shots;
  // Backfill reusable source windows for older Blueprints before a variant
  // asks a provider to regenerate any motion shot.
  let next = videoRuntime
    ? await Promise.all(shots.map((shot) => ensureReferenceVideoUrl(job, shot, referenceFile)))
    : shots.map((shot) => ({ ...shot }));
  for (const index of indexes) {
    const shot = next[index];
    if (!shot) continue;
    // Prefer video-to-video/reference-video when the base shot was a video or
    // when the local video model is the only way to preserve motion. If that
    // route is unavailable, an explicit image fallback is still valid, but it
    // must be a newly generated image rather than the previous reference
    // frame.
    const preferVideo = Boolean(videoRuntime && (shot.videoUrl || shot.strategy !== 'static'));
    if (preferVideo) {
      let videoUrl: string | null = null;
      try {
        // Drop the old generated pixels before the request. The reference
        // frame/video remains available as structural guidance, but a changed
        // prompt must not accidentally inherit the previous result as its
        // first frame.
        const regenerationShot: CloneShot = {
          ...shot,
          imageUrl: undefined,
          videoUrl: undefined,
          preserveReferenceFrame: false,
        };
        videoUrl = await generateShotVideo(videoRuntime, job, regenerationShot, true, referenceFile);
      } catch {
        // A provider may reject a reference transport or a duration. Continue
        // to the image path so the variant still gets a genuinely new frame.
      }
      if (videoUrl) {
        next[index] = { ...shot, videoUrl, imageUrl: undefined, preserveReferenceFrame: false, status: 'done', error: undefined };
        continue;
      }
    }
    const imageUrl = await generateShotImage(imageRuntime, job, { ...shot, preserveReferenceFrame: false }, { forceRegenerate: true });
    if (!imageUrl || imageUrl === shot.referenceFrameUrl) {
      throw new Error(`变体镜头 ${index + 1} 没有生成新的画面，请检查生图/视频模型是否可用`);
    }
    next[index] = { ...shot, imageUrl, videoUrl: undefined, preserveReferenceFrame: false, status: 'done', error: undefined };
  }
  return next;
}

/** Generate only changed voice clips; unchanged audio URLs stay untouched. */
async function renderVariantVoice(job: CloneJob, shots: CloneShot[], indexes: readonly number[], runtime: SpeechRuntime | null) {
  if (!indexes.length) return shots;
  if (!runtime && !offlineSpeechSupported()) throw new Error('变体修改了口播，但当前没有可用的配音模型或本机离线语音引擎');
  let next = shots.map((shot) => ({ ...shot }));
  for (const index of indexes) {
    const shot = next[index];
    if (!shot?.line?.trim()) continue;
    const result = await voiceShot(runtime, job, shot, index);
    next[index] = { ...shot, audioUrl: result.url, audioSeconds: result.seconds, status: 'done', error: undefined };
  }
  return next;
}

async function cloneImageReference(job: CloneJob, value: string) {
  if (value.startsWith('data:image/')) return value;
  const state = await getPublicState();
  if (value.startsWith('/api/storage/file')) {
    const name = new URL(value, 'http://localhost').searchParams.get('name') || '';
    const file = resolveStoredFileWithFallback(state.settings.imageStoragePath || '', name);
    if (file && existsSync(file)) return `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { cache: 'no-store' });
    if (response.ok) return `data:${response.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  }
  throw new Error(`无法读取参考帧：${job.reference.name}`);
}

async function generateShotVideo(runtime: VideoRuntime, job: CloneJob, shot: CloneShot, useFirstFrame = true, referenceFile?: string) {
  if (!runtime) return null;
  const referenceSeconds = Math.max(0, Number(shot.end || 0) - Number(shot.start || 0));
  const requestedSeconds = job.options.preserveReferenceTiming !== false
    ? Math.max(referenceSeconds, Number(shot.audioSeconds) || 0, 4)
    : Number(shot.audioSeconds) || 4;
  const seconds = clampShotSeconds(Math.round(requestedSeconds), getVideoModelLimits(runtime.model, runtime.provider));
  // strategy 缺失的是 0.7.50 以前的旧任务：沿用「参考图 + 已生成首帧」的旧链路，
  // 不能因为升级 Blueprint 而悄悄变成纯文生视频。
  const legacyStrategy = !shot.strategy;
  // Ordinary shots also receive their recovered source frame. This preserves
  // framing and visual rhythm instead of reducing the reference to text.
  const canUseReferenceImages = job.capabilities.referenceImages;
  const referenceImages = canUseReferenceImages && (shot.strategy === 'reference' || legacyStrategy || Boolean(shot.referenceFrameUrl))
    ? await cloneImageReferences(job, shot)
    : [];
  const useKeyframe = job.capabilities.firstFrame && (shot.strategy === 'keyframe' || legacyStrategy || Boolean(shot.referenceFrameUrl));
  const audios = shot.speechMode === 'talking' && job.capabilities.referenceAudio ? cloneAudioReferences(job, shot) : [];
  let referenceVideo: string | undefined;
  if (job.capabilities.referenceVideo && referenceFile) {
    referenceVideo = await referenceVideoDataUrl(shot.referenceVideoUrl) || undefined;
  }
  if (!referenceVideo && job.capabilities.referenceVideo && referenceFile) {
    const directory = path.join(cloneJobDirectory(job.id), 'reference-segments');
    await mkdir(directory, { recursive: true });
    const segmentFile = path.join(directory, `shot-${String(shot.index).padStart(3, '0')}.mp4`);
    if (!existsSync(segmentFile)) await extractVideoSegment(referenceFile, shot.start, shot.end, segmentFile);
    const segment = await readFile(segmentFile);
    // Inline media is accepted by every provider adapter; remote transports
    // turn it into a signed public URL and local CLI transports materialize it.
    referenceVideo = `data:video/mp4;base64,${segment.toString('base64')}`;
  }
  const referenceVideos = referenceVideo ? [referenceVideo] : [];
  const input: VideoGenerationInput = {
    prompt: `${cloneShotDirection(shot, job.options.brief)}${visualBiblePrompt(job.blueprint?.visualBible || job.referenceAnalysis?.visualBible)}；自然运动，不要额外添加文字水印`,
    operation: 'generate',
    seconds,
    aspectRatio: job.options.aspect,
    ...(referenceImages.length && !referenceVideos.length ? { referenceImages, videoMode: 'reference' as const } : {}),
    ...(referenceVideos.length ? { referenceVideos, referenceVideo, videoMode: 'reference' as const } : {}),
    ...(useKeyframe && useFirstFrame && (shot.imageUrl || shot.referenceFrameUrl)
      ? { firstFrame: shot.imageUrl || shot.referenceFrameUrl }
      : {}),
    ...(audios.length ? { audios, requireAudio: true } : {}),
  };
  // 参考图模式与首帧模式互斥；若已有关键帧，优先使用关键帧保证镜头构图。
  if (referenceVideos.length) {
    // Reference-video mode and first-frame mode are mutually exclusive on
    // Agnes; the source segment already carries the exact opening frame.
    delete input.firstFrame;
    delete input.lastFrame;
    delete input.referenceImages;
  }
  if (useKeyframe && shot.imageUrl && referenceImages.length && !referenceVideos.length) {
    delete input.referenceImages;
    delete input.videoMode;
  }
  const task = await createVideoGeneration({ modelId: runtime.model.id, input, source: 'canvas' });
  if (!task) throw new Error('视频任务创建失败。');
  if (task.status === 'failed') throw new Error(task.error || '视频任务失败。');
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  let current = task;
  let lastHeartbeat = Date.now();
  while (current.status === 'pending' || current.status === 'running') {
    if (Date.now() > deadline) throw new Error('视频生成等待超时。');
    if (await isCancelled(job.id)) return null;
    await sleep(VIDEO_POLL_INTERVAL_MS);
    current = (await refreshVideoTask(current.id)) || current;
    if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = Date.now();
      await touchCloneJob(job.id);
    }
  }
  if (current.status !== 'done') throw new Error(current.error || '视频任务未完成。');
  const url = current.videoUrls[0];
  if (!url) throw new Error('视频任务完成但没有可用的本地地址。');
  return url;
}

/**
 * 图生视频要把本地首帧换成公网地址；Agnes 这类服务商没有中转就提交不了。
 * 提前判一次：不可用就整体退成文生视频（仍然出片），而不是每个镜头各失败一次。
 */
async function firstFrameTransportReady(runtime: VideoRuntime) {
  if (!runtime) return false;
  if (!requiresPublicMediaRelay(runtime.provider, { hasVideoModel: true })) return true;
  try {
    const status = await getPublicMediaTransportStatusLive();
    return status.mode !== 'unavailable';
  } catch {
    return false;
  }
}

/** 落地参考视频并读出时长（封顶在用户设置的 maxSeconds）。 */
async function resolveReference(job: CloneJob): Promise<[string, number]> {
  const referenceFile = await materializeReference(job);
  const probed = await probeMediaSeconds(referenceFile);
  const duration = round3(Math.min(probed || job.reference.seconds || 15, job.options.maxSeconds));
  if (!duration) throw new Error('参考视频时长读取失败，请换一条视频再试。');
  await patchJob(job.id, { reference: { ...job.reference, seconds: duration } });
  return [referenceFile, duration];
}
/** 跑一条克隆任务。可重复调用：已完成/已取消直接返回；已生成的镜头与配音会跳过（中断可续跑）。 */
/**
 * 同一个任务同时只能有一个执行器。前端的幂等键会让重复点击「开始」命中同一个任务，
 * 但每次 POST 都会再调一次 runCloneJob；没有这层锁就会两条管线并行，重复生图、生视频。
 */
const runningJobs = new Set<string>();

/**
 * 把「执行进程已经没了、阶段却停在半路」的任务标成失败。应用重启后前端只会看到一条
 * 永不推进的进度条，用户既不知道要等还是该重来；标成失败后弹窗会出现「继续任务」，
 * 已经生成好的镜头与配音会被跳过，不会重复计费。
 */
export async function reapStaleCloneJobs() {
  const jobs = await listCloneJobs(50);
  const stale = jobs.filter((job) => isCloneJobStale(job) && !runningJobs.has(job.id));
  for (const job of stale) {
    await updateCloneJob(job.id, {
      stage: 'failed',
      message: CLONE_INTERRUPTED_MESSAGE,
      error: CLONE_INTERRUPTED_MESSAGE,
      finishedAt: new Date().toISOString(),
    });
  }
  return stale.length;
}

export async function runCloneJob(id: string) {
  if (runningJobs.has(id)) return await findCloneJob(id);
  runningJobs.add(id);
  try {
    return await executeCloneJob(id);
  } finally {
    runningJobs.delete(id);
  }
}

async function executeCloneJob(id: string) {
  const started = await findCloneJob(id);
  if (!started) throw new Error('任务不存在。');
  if (started.stage === 'done' || started.stage === 'cancelled') return started;
  if (started.stage === 'planned' && !started.planConfirmed) return started;
  try {
    await patchJob(id, { stage: 'analyzing', progress: cloneStageProgress('analyzing'), message: '正在拆解参考视频', error: undefined });
    // 高级设置里选的模型要真的生效：优先按 job.modelIds 精确取，取不到再退回自动选择。
    const [chatPick, imagePick, videoPick, speechPick] = await Promise.all([
      // 拆解要真的看图：没显式选模型时优先带 vision 的对话模型。
      resolveSelectedModel(started.modelIds?.chat, '对话 / 拆解模型', (id) => getRuntimeVisionModel(id)),
      resolveSelectedModel(started.modelIds?.image, '生图模型', (id) => getRuntimeImageGenerationModel(id)),
      resolveSelectedModel(started.modelIds?.video, '图生视频模型', (id) => getRuntimeVideoModel(id)),
      resolveSelectedModel(started.modelIds?.speech, '配音模型', (id) => resolveSpeechRuntime(id)),
    ]);
    const chatRuntime = chatPick.value;
    const imageRuntime = imagePick.value;
    const videoRuntime = videoPick.value;
    const speechRuntime = speechPick.value;
    const executionCapabilities = capabilitiesForExecution(chatRuntime, imageRuntime, videoRuntime, speechRuntime);
    let executionJob: CloneJob = { ...started, capabilities: executionCapabilities };
    await patchJob(id, { capabilities: executionCapabilities });
    const needsNewImages = started.shots.some((shot) =>
      !shot.imageUrl
      && !shot.referenceFrameUrl
      && shot.strategy !== 'reference'
      && shot.strategy !== 'text'
      && !shot.preserveReferenceFrame,
    );
    const runtimeWarnings = [chatPick.warning, imagePick.warning, videoPick.warning, speechPick.warning].filter(Boolean);
    if (!imageRuntime && needsNewImages) runtimeWarnings.push('没有可用的生图模型：将使用抽取到的参考帧静态降级，主体不会被重新绘制。');
    // 没有在线 TTS 模型时：Windows 用系统自带语音合成兜底，其它平台维持「无声 + 字幕」。
    const voiceMode: 'model' | 'offline' | 'none' = speechRuntime ? 'model' : offlineSpeechSupported() ? 'offline' : 'none';
    if (voiceMode === 'none' && executionCapabilities.speech) {
      runtimeWarnings.push('创建任务时的配音模型已不可用：本次成片为无声 + 字幕，时长按字数估算。');
    }
    if (voiceMode === 'offline' && !executionCapabilities.offlineSpeech) {
      runtimeWarnings.push('在线配音模型不可用：本次改用「本机离线配音」出声（免费、离线、不需联网，音色偏机械）。');
    }
    if (runtimeWarnings.length) await appendWarnings(id, runtimeWarnings);

    const [referenceFile, duration] = await resolveReference(started);
    const transcriptResult = started.referenceAnalysis?.transcriptData
      ? { transcript: started.referenceAnalysis.transcriptData, error: '' }
      : await loadReferenceTranscript(id, referenceFile, duration).catch((error) => ({
        transcript: null,
        error: error instanceof Error ? error.message : '本地 ASR 失败',
      }));
    const referenceTranscript = transcriptResult.transcript;
    if (transcriptResult.error) await appendWarnings(id, [`参考视频本地 ASR 未完成：${transcriptResult.error}；将继续使用画面拆解和原始环境音。`]);
    // A confirmed Blueprint is authoritative even when it contains
    // reference-only gap shots without narration. Checking every `line`
    // treated those intentional structural intervals as an incomplete plan,
    // causing a resume to rerun vision/scripting and potentially change the
    // cut structure after the user had already confirmed it.
    const resumed = Boolean(started.planConfirmed && started.shots.length);
    let shots: CloneShot[];
    let visualBibleFrames: string[] = [];
    if (resumed) {
      shots = started.shots;
      await patchJob(id, { shots, message: `沿用已有的 ${shots.length} 个镜头` });
    } else {
      const scene = await detectSceneChanges(referenceFile, { durationSeconds: duration, maxChanges: Math.max(1, started.options.maxShots * 3) }).catch((error) => ({ times: [], error: error instanceof Error ? error.message : '本地切点检测失败' }));
      const frames = await extractFrameFiles(referenceFile, referenceFrameSampleTimes(duration, scene.times), path.join(cloneJobDirectory(id), 'frames'));
      visualBibleFrames = await frameDataUrls(frames.files);
      const analyzedFrames = { ...frames, sceneChangeTimes: scene.times };
      if (scene.error) await appendWarnings(id, [`本地镜头切点检测未完成：${scene.error}；将继续使用抽帧和视觉模型分析。`]);
      if (await isCancelled(id)) return await finishCancelled(id);
      const analysis = await analyzeShots(chatRuntime, analyzedFrames, executionJob, duration);
      const normalized = analysis.shots;
      // 拆解降级要立刻落库：后面如果文案阶段直接失败，这条提示不能被吞掉。
      if (analysis.warning) await appendWarnings(id, [analysis.warning]);
      await patchJob(id, { stage: 'scripting', progress: cloneStageProgress('scripting'), message: '正在重写文案' });
      const { lines, prompts } = await writeScript(chatRuntime, executionJob, normalized, referenceTranscript);
      const merged = normalized.map((shot, index) => ({ ...shot, prompt: prompts.get(index) || shot.prompt }));
      const scriptLines = lines.length
        ? lines.flatMap((line) => { const parts = splitLines(line); return parts.length ? parts : [line]; })
        : merged.map((shot) => transcriptForShot(referenceTranscript, shot.start, shot.end) || shot.visual).filter(Boolean);
      const scriptWarnings = [
        // 模型没返回句子、但还有画面描述可顶：口播先用画面描述代替。
        lines.length || !scriptLines.length ? '' : '文案重写没有返回可用句子：口播暂时用画面拆解描述代替，建议检查对话模型后重跑（成片仍可导出）。',
        // 连画面描述都拿不到（一个对话模型都没配）：不再整条失败，降级成「只有画面」的成片，
        // 用户至少能拿到片子，而不是白跑一趟生图 / 生视频。两条提示互斥，别同时冒出来。
        scriptLines.length ? '' : '没有生成出可用的口播文案：本次成片只有画面，没有配音与字幕；在「模型库」启用一个对话模型后重跑就能补上。',
      ].filter(Boolean);
      // Keep reference-only gaps and every recovered cut in the execution path
      // as well as the explicit planning path. Otherwise a confirmed plan can
      // be silently collapsed when the worker resumes it from the queue.
      shots = alignShotsWithLines(merged, scriptLines, { preserveShotStructure: true });
      await patchJob(id, { shots, message: `已拆出 ${shots.length} 个镜头` });
      if (scriptWarnings.length) await appendWarnings(id, scriptWarnings);
    }

    // Confirmed jobs normally arrive here with a persisted visual bible from
    // analyzeCloneJob. Older/directly-created jobs may not have one; recover a
    // deterministic fallback (or a multimodal bible when frames are present)
    // before any image/video provider sees the shot prompts.
    const existingVisualBible = executionJob.blueprint?.visualBible || executionJob.referenceAnalysis?.visualBible;
    if (!existingVisualBible) {
      const visualBible = await analyzeVisualBible(chatRuntime, visualBibleFrames, shots, executionJob);
      if (visualBible) {
        const current = await findCloneJob(id);
        const referenceAnalysis = current?.referenceAnalysis || executionJob.referenceAnalysis;
        const now = new Date().toISOString();
        const blueprint = current?.blueprint || executionJob.blueprint;
        const nextReferenceAnalysis = referenceAnalysis
          ? { ...referenceAnalysis, visualBible }
          : buildReferenceAnalysis(duration, { files: [], times: [] }, shots, 'fallback', [], referenceTranscript, undefined, visualBible);
        const nextBlueprint = blueprint
          ? { ...blueprint, visualBible, shots, updatedAt: now }
          : {
            version: 1 as const,
            sourceVideo: executionJob.reference,
            assets: executionJob.assets || [],
            shots,
            visualBible,
            components: buildBlueprintComponents(shots),
            createdAt: now,
            updatedAt: now,
          };
        await patchJob(id, { referenceAnalysis: nextReferenceAnalysis, blueprint: nextBlueprint });
        executionJob = { ...executionJob, referenceAnalysis: nextReferenceAnalysis, blueprint: nextBlueprint };
      }
    }

    if (voiceMode !== 'none') {
      await patchJob(id, { stage: 'voicing', progress: cloneStageProgress('voicing'), message: voiceMode === 'offline' ? '正在用本机语音合成配音' : '正在生成配音' });
      const voiceWarnings: string[] = [];
      for (const [index, shot] of shots.entries()) {
        if (await isCancelled(id)) return await finishCancelled(id);
        if (!shot.line || shot.audioUrl) continue;
        try {
          const voice = await voiceShot(speechRuntime, executionJob, shot, index);
          shots = replaceShot(shots, index, { audioUrl: voice.url, audioSeconds: voice.seconds });
          // 用户填的可能是别的平台的音色名（如 OpenAI 的 nova）：离线合成会拿系统中文音色顶上，要说清楚。
          const requestedVoice = String(started.options.voice || '').trim();
          if (voice.voice && requestedVoice && voice.voice !== requestedVoice) {
            voiceWarnings.push('本机离线配音没有「' + requestedVoice + '」这个音色：已改用系统音色「' + voice.voice + '」。');
          }
          await patchJob(id, { shots, progress: round3(cloneStageProgress('voicing') + (0.12 * (index + 1)) / shots.length) });
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          voiceWarnings.push(`第 ${index + 1} 句配音失败：${message}`);
          // 镜头级也要留痕：否则用户只看到「少了一句配音」，不知道是哪一句、为什么。
          shots = replaceShot(shots, index, { error: message });
        }
      }
      const job = await findCloneJob(id);
      await patchJob(id, { shots, warnings: mergeWarnings(job?.warnings || started.warnings, voiceWarnings) });
    }

    await patchJob(id, { stage: 'imaging', progress: cloneStageProgress('imaging'), message: '正在生成画面' });
    const imageWarnings: string[] = [];
    const shotsNeedingImage = shots.filter((shot) =>
      !shot.imageUrl
      && !shot.preserveReferenceFrame
      && shot.strategy !== 'reference'
      && (shot.strategy !== 'text' || Boolean(shot.referenceFrameUrl)),
    );
    let imagesDone = shots.length - shotsNeedingImage.length;
    await mapWithConcurrency(shots, IMAGE_CONCURRENCY, async (shot, index) => {
      if (
        await isCancelled(id)
        || shot.imageUrl
        || shot.preserveReferenceFrame
        || shot.strategy === 'reference'
        || (shot.strategy === 'text' && !shot.referenceFrameUrl)
      ) return;
      try {
        const imageUrl = await generateShotImage(imageRuntime, executionJob, shot);
        if (imageUrl) shots = replaceShot(shots, index, { imageUrl, status: 'rendering' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '生图失败';
        imageWarnings.push(`第 ${index + 1} 个镜头生图失败：${message}`);
        shots = replaceShot(shots, index, {
          ...fallbackShotToReferenceFrame({ ...shot, error: message }),
          error: message,
        });
      }
      imagesDone += 1;
      await patchJob(id, { shots, progress: round3(cloneStageProgress('imaging') + 0.26 * (imagesDone / Math.max(1, shots.length))) });
    });
    if (imageWarnings.length) {
      const job = await findCloneJob(id);
      await patchJob(id, { shots, warnings: mergeWarnings(job?.warnings || started.warnings, imageWarnings) });
    }

    if (videoRuntime) {
      await patchJob(id, { stage: 'rendering', progress: cloneStageProgress('rendering'), message: '正在生成镜头' });
      const videoWarnings: string[] = [];
      // 新任务必须显式声明首帧能力；旧任务没有该字段时保留历史行为。
      const useFirstFrame = executionCapabilities.firstFrame !== false && await firstFrameTransportReady(videoRuntime);
      if (!useFirstFrame && !executionCapabilities.referenceImages && !executionCapabilities.referenceVideo) {
        videoWarnings.push('图生视频需要服务商能访问的公网图片地址，当前没有连上图片中转；普通镜头已保留参考帧静态出片，避免退回与原片无关的文生视频。');
      }
      if (executionCapabilities.referenceVideo && referenceFile) {
        // Persist the exact source window once. Subsequent retries, Blueprint
        // variants and local re-assemblies reuse the same motion reference.
        shots = await Promise.all(shots.map((shot) => ensureReferenceVideoUrl(executionJob, shot, referenceFile)));
        await patchJob(id, { shots });
      }
      let rendered = shots.filter((shot) => shot.videoUrl).length;
      await mapWithConcurrency(shots, VIDEO_CONCURRENCY, async (shot, index) => {
        if (await isCancelled(id) || shot.videoUrl) return;
        if (shot.preserveReferenceFrame) {
          shots = replaceShot(shots, index, { status: 'done' });
          await patchJob(id, { shots });
          return;
        }
        // If the configured video transport cannot consume the recovered
        // frame, keep that exact frame as a deterministic static fallback
        // instead of asking for a text-only shot that breaks the reference
        // composition. This is especially important when firstFrame exists
        // in the model catalog but its public media relay is unavailable.
        const canCarryReferenceFrame = useFirstFrame || executionCapabilities.referenceVideo || executionCapabilities.referenceImages;
        if (shot.referenceFrameUrl && !canCarryReferenceFrame) {
          shots = replaceShot(shots, index, { imageUrl: shot.referenceFrameUrl, status: 'done' });
          await patchJob(id, { shots });
          return;
        }
        if (shot.strategy === 'static') {
          shots = replaceShot(shots, index, { status: shot.imageUrl ? 'done' : 'failed' });
          await patchJob(id, { shots });
          return;
        }
        let videoUrl: string | null = null;
        let failure = '';
        for (let attempt = 0; attempt <= VIDEO_RETRY_WAITS_MS.length; attempt += 1) {
          try {
            videoUrl = await generateShotVideo(videoRuntime, executionJob, shot, useFirstFrame, referenceFile);
            failure = '';
            break;
          } catch (error) {
            failure = error instanceof Error ? error.message : '视频失败';
            const wait = VIDEO_RETRY_WAITS_MS[attempt];
            if (!wait || !isTransientVideoError(failure) || await isCancelled(id)) break;
            await patchJob(id, { message: `第 ${index + 1} 个镜头被服务商限流，等 ${Math.round(wait / 1000)} 秒后重试` });
            await sleep(wait);
          }
        }
        if (videoUrl) shots = replaceShot(shots, index, { videoUrl, status: 'done' });
        else if (await isCancelled(id)) return; // 取消导致的空结果不是「失败」，别留误导性的降级提示
        else {
          videoWarnings.push(`第 ${index + 1} 个镜头退回静态图：${failure}`);
          shots = replaceShot(shots, index, {
            ...fallbackShotToReferenceFrame({ ...shots[index], error: failure }),
            error: failure,
          });
        }
        rendered += 1;
        await patchJob(id, { shots, progress: round3(cloneStageProgress('rendering') + 0.26 * Math.min(1, rendered / shots.length)) });
      });
      if (videoWarnings.length) {
        const job = await findCloneJob(id);
        await patchJob(id, { shots, warnings: mergeWarnings(job?.warnings || started.warnings, videoWarnings) });
      }
    } else {
      shots = shots.map((shot) => {
        const fallback = fallbackShotToReferenceFrame(shot);
        return { ...fallback, status: fallback.imageUrl || fallback.preserveReferenceFrame ? 'done' : 'failed' };
      });
      await patchJob(id, { shots, progress: cloneStageProgress('assembling'), message: '没有视频模型，改用静态图合成' });
    }

    if (await isCancelled(id)) return await finishCancelled(id);
    await patchJob(id, { stage: 'assembling', progress: cloneStageProgress('assembling'), message: '正在合成时间轴' });
    const generatedTimeline = buildTimeline(shots, started.options, referenceTranscript);
    const draftTimeline = started.timeline.editorState
      ? timelineWithEditorState(generatedTimeline, normalizeVideoEditorState(started.timeline.editorState))
      : generatedTimeline;
    // maxSeconds 只约束「拆解参考视频的长度」，成片长度由配音实际时长决定：
    // 文案写长了就会超，要当面说清楚，而不是默默吐出一条超额成片。
    if (draftTimeline.duration > started.options.maxSeconds + 0.5) {
      await appendWarnings(id, ['成片 ' + draftTimeline.duration + ' 秒超过设置的参考上限 ' + started.options.maxSeconds + ' 秒（时长按配音实际长度排）：把「镜头数上限」调小，或在要求里限定每句字数。']);
    }
    const currentJob = await findCloneJob(id);
    if (!currentJob) throw new Error('克隆任务已不存在');
    const publicState = await getPublicState();
    const timeline = await materializeReferenceAudioTrack(referenceFile, draftTimeline, cloneJobDirectory(id));
    const assembled = await assembleCloneVideo({
      job: { ...currentJob, shots, timeline },
      timeline,
      referenceFile,
      workingDirectory: path.join(cloneJobDirectory(id), 'assembly'),
      imageStoragePath: publicState.settings.imageStoragePath || '',
      videoStoragePath: publicState.settings.videoStoragePath || '',
      // TTS assets are persisted through the audio store and the assembly
      // stage must resolve their /api/storage/audio URLs from the same local
      // media roots. Without this, successful voice generation could be
      // silently replaced by ambience during the final render.
      audioStoragePath: getDefaultAudioStoragePath(),
      onProgress: async (progress) => {
        await patchJob(id, {
          shots,
          timeline,
          progress: round3(cloneStageProgress('assembling') + 0.06 * progress),
          message: `正在合成最终视频（${Math.round(progress * 100)}%）`,
        });
      },
    });
    if (assembled.warnings.length) await appendWarnings(id, assembled.warnings);
    const finalTimeline = { ...timeline, finalVideoUrl: assembled.url, finalVideoMime: assembled.mime };
    const finishedJob = await findCloneJob(id);
    const finished = await patchJob(id, {
      shots,
      timeline: finalTimeline,
      blueprint: finishedJob?.blueprint
        ? { ...finishedJob.blueprint, shots, components: timeline.components || buildBlueprintComponents(shots), updatedAt: new Date().toISOString() }
        : started.blueprint,
      stage: 'done',
      progress: 1,
      message: `已生成完整成片（${Math.round(finalTimeline.duration)} 秒）`,
      finishedAt: new Date().toISOString(),
      warnings: finishedJob?.warnings || started.warnings,
      error: undefined,
    });
    await cleanupCloneJobDirectory(id);
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : '克隆出片失败';
    return await patchJob(id, { stage: 'failed', progress: 0, message, error: message, finishedAt: new Date().toISOString() });
  }
}

/** 只执行抽帧、视觉拆解和文案规划，不触发生图/视频/TTS。 */
export async function analyzeCloneJob(id: string) {
  const heartbeat = setInterval(() => { void touchCloneJob(id); }, HEARTBEAT_INTERVAL_MS);
  try {
    const job = await findCloneJob(id);
    if (!job) throw new Error('任务不存在');
    if (job.planConfirmed || job.stage === 'done') return job;
    await patchJob(id, { stage: 'analyzing', progress: cloneStageProgress('analyzing'), message: '正在分析参考视频' });
    const chatPick = await resolveSelectedModel(job.modelIds?.chat, '对话 / 拆解模型', (modelId) => getRuntimeVisionModel(modelId));
    const [referenceFile, duration] = await resolveReference(job);
    const analysisCapabilities = {
      ...job.capabilities,
      vision: Boolean(chatPick.value?.model.capabilities.includes('vision')),
    };
    const analysisJob: CloneJob = { ...job, capabilities: analysisCapabilities };
    await patchJob(id, { capabilities: analysisCapabilities });
  const transcriptResult = job.referenceAnalysis?.transcriptData
    ? { transcript: job.referenceAnalysis.transcriptData, error: '' }
    : await loadReferenceTranscript(id, referenceFile, duration).catch((error) => ({
      transcript: null,
      error: error instanceof Error ? error.message : '本地 ASR 失败',
    }));
  const referenceTranscript = transcriptResult.transcript;
  if (transcriptResult.error) await appendWarnings(id, [`参考视频本地 ASR 未完成：${transcriptResult.error}；计划阶段仍会保留原始音频。`]);
  const scene = await detectSceneChanges(referenceFile, { durationSeconds: duration, maxChanges: Math.max(1, job.options.maxShots * 3) }).catch((error) => ({ times: [], error: error instanceof Error ? error.message : '本地切点检测失败' }));
  const frames = await extractFrameFiles(referenceFile, referenceFrameSampleTimes(duration, scene.times), path.join(cloneJobDirectory(id), 'frames'));
  const analyzedFrames = { ...frames, sceneChangeTimes: scene.times };
  if (scene.error) await appendWarnings(id, [`本地镜头切点检测未完成：${scene.error}；将继续使用抽帧和视觉模型分析。`]);
  const ocr = await analyzeReferenceOcr(frames);
  if (!localOcrAvailable()) await appendWarnings(id, ['本地 OCR 未启用：优先使用视觉模型返回的 graphicsText / graphicsPosition；安装并配置 Tesseract 后可获得更准确的字卡检测。']);
  const analysis = await analyzeShots(chatPick.value, analyzedFrames, analysisJob, duration);
  if (analysis.warning) await appendWarnings(id, [analysis.warning]);
  const normalized = enrichShotsFromOcr(analysis.shots, ocr);
  await patchJob(id, { stage: 'scripting', progress: cloneStageProgress('scripting'), message: '正在根据参考节奏重写文案' });
  const { lines, prompts } = await writeScript(chatPick.value, analysisJob, normalized, referenceTranscript);
  const merged = normalized.map((shot, index) => ({ ...shot, prompt: prompts.get(index) || shot.prompt }));
  const scriptLines = lines.length
    ? lines.flatMap((line) => { const parts = splitLines(line); return parts.length ? parts : [line]; })
    : merged.map((shot) => transcriptForShot(referenceTranscript, shot.start, shot.end) || shot.visual).filter(Boolean);
  // Keep every recovered reference interval, including intervals the script
  // model did not mention. Hypit treats these as structural timeline windows;
  // collapsing them into the previous shot changes the cut rhythm and can
  // erase a card, transition, or B-roll beat from the final MP4.
  const aligned = alignShotsWithLines(merged, scriptLines, { preserveShotStructure: true });
  let planned = await planShotDependencies(chatPick.value, analysisJob, aligned);
  const plannedWithFrames = await attachReferenceFrames(planned, frames);
  planned = plannedWithFrames;
  const now = new Date().toISOString();
  const visualBible = await analyzeVisualBible(chatPick.value, await frameDataUrls(frames.files), plannedWithFrames, job);
  const referenceAnalysis = buildReferenceAnalysis(
    duration,
    analyzedFrames,
    plannedWithFrames,
    chatPick.value && analysisCapabilities.vision && frames.files.length ? 'multimodal-frames' : 'fallback',
    scene.times,
    referenceTranscript,
    ocr,
    visualBible,
  );
    return await patchJob(id, {
      stage: 'planned', progress: cloneStageProgress('planned'), message: `已生成 ${planned.length} 个镜头计划，等待确认`, shots: planned, planConfirmed: false,
      referenceAnalysis,
      blueprint: { version: 1, sourceVideo: job.reference, assets: job.assets || [], shots: plannedWithFrames, visualBible, components: buildBlueprintComponents(plannedWithFrames), createdAt: job.blueprint?.createdAt || now, updatedAt: now },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '参考视频分析失败';
    return await patchJob(id, { stage: 'failed', progress: 0, message, error: message, finishedAt: new Date().toISOString() });
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Re-assemble a completed blueprint without calling vision, image, video or
 * speech providers again. Persisted shot media stays attached to each shot;
 * only the timeline and structured analysis edits are consumed.
 */
export async function rerenderCloneJob(id: string, requestedShots?: CloneShot[], requestedTimeline?: CanvasVideoEditorState) {
  const job = await findCloneJob(id);
  if (!job) throw new Error('克隆任务不存在');
  if (!job.blueprint && !job.shots.length) throw new Error('这条任务没有可重出的 Blueprint');
  if (job.stage !== 'done' && job.stage !== 'failed') throw new Error('任务仍在运行，请等待当前任务结束后再重出');
  if (requestedShots && requestedShots.length !== job.shots.length) throw new Error('重出镜头数量与原任务不一致');
  const shots = requestedShots || job.shots;
  const editorState = requestedTimeline
    ? normalizeVideoEditorState(requestedTimeline)
    : job.timeline.editorState;
  const updated = await updateCloneJob(id, {
    shots,
    planConfirmed: true,
    stage: 'queued',
    progress: 0,
    message: '已载入 Blueprint，准备重新合成',
    error: undefined,
    cancelRequested: false,
    finishedAt: undefined,
    timeline: editorState ? { ...job.timeline, editorState } : job.timeline,
    blueprint: job.blueprint ? { ...job.blueprint, shots, components: buildBlueprintComponents(shots), updatedAt: new Date().toISOString() } : undefined,
  });
  // A timeline edit is a local assembly operation. Do not send it through
  // executeCloneJob: that path resolves providers and may start new TTS,
  // image, or video generation for an already completed blueprint.
  void runCloneReassembly(id).catch(() => undefined);
  return updated;
}

/**
 * Render a named Blueprint variant, regenerating only the media affected by
 * the variant before assembling a complete MP4. Unchanged media remains
 * reusable, while changed visuals and voice are never silently kept stale.
 */
export async function renderBlueprintVariant(id: string, spec: CloneBlueprintVariantSpec) {
  const job = await findCloneJob(id);
  if (!job?.blueprint) throw new Error('这条任务还没有可复用的 Blueprint');
  if (job.stage !== 'done' && job.stage !== 'failed') throw new Error('请等待基础克隆成片完成后再渲染变体');
  const plan = buildBlueprintVariantPlan(job.blueprint, spec, job.options, job.referenceAnalysis?.transcriptData);
  // The plan is executable when neither generationShotIndexes.length nor
  // plan.voiceShotIndexes.length is non-zero; otherwise complete those media
  // first and only then assemble the final MP4.
  const needsVariantMedia = plan.generationShotIndexes.length || plan.voiceShotIndexes.length;
  const [imagePick, videoPick, speechPick] = await Promise.all([
    resolveSelectedModel(job.modelIds?.image, '生图模型', (modelId) => getRuntimeImageGenerationModel(modelId)),
    resolveSelectedModel(job.modelIds?.video, '图生视频模型', (modelId) => getRuntimeVideoModel(modelId)),
    resolveSelectedModel(job.modelIds?.speech, '配音模型', (modelId) => resolveSpeechRuntime(modelId)),
  ]);
  const variantCapabilities = capabilitiesForExecution(null, imagePick.value, videoPick.value, speechPick.value);
  const variantJob: CloneJob = { ...job, capabilities: { ...job.capabilities, ...variantCapabilities } };
  if (needsVariantMedia && plan.generationShotIndexes.length && !imagePick.value && !videoPick.value) {
    throw new Error(`变体需要补生成画面（镜头 ${plan.generationShotIndexes.map((index) => index + 1).join('、')}），但当前没有可用的生图或视频模型`);
  }
  if (needsVariantMedia && plan.voiceShotIndexes.length && !speechPick.value && !offlineSpeechSupported()) {
    throw new Error(`变体需要补配音（镜头 ${plan.voiceShotIndexes.map((index) => index + 1).join('、')}），但当前没有可用的配音模型或本机离线语音引擎`);
  }
  const referenceFile = await materializeReference(job);
  try {
    const publicState = await getPublicState();
    const withMedia = await renderVariantMedia(
      variantJob,
      plan.shots,
      plan.generationShotIndexes,
      referenceFile,
      imagePick.value,
      videoPick.value,
    );
    const renderedShots = await renderVariantVoice(variantJob, withMedia, plan.voiceShotIndexes, speechPick.value);
    const renderedTimeline = buildTimeline(renderedShots, job.options, job.referenceAnalysis?.transcriptData);
    const timeline = await materializeReferenceAudioTrack(referenceFile, renderedTimeline, cloneJobDirectory(id));
    const assembled = await assembleCloneVideo({
      job: { ...variantJob, shots: renderedShots, timeline },
      timeline,
      referenceFile,
      workingDirectory: path.join(cloneJobDirectory(id), `variant-${plan.id}`),
      imageStoragePath: publicState.settings.imageStoragePath || '',
      videoStoragePath: publicState.settings.videoStoragePath || '',
      audioStoragePath: getDefaultAudioStoragePath(),
    });
    const finalTimeline = { ...timeline, finalVideoUrl: assembled.url, finalVideoMime: assembled.mime };
    const current = await findCloneJob(id);
    const blueprint = current?.blueprint || job.blueprint;
    const savedSpec = {
      ...spec,
      id: plan.id,
      name: plan.name,
      ...(plan.description ? { description: plan.description } : {}),
      finalVideoUrl: assembled.url,
      finalVideoMime: assembled.mime,
      renderedAt: new Date().toISOString(),
    };
    const variants = [...(blueprint.variants || []).filter((variant) => variant.id !== savedSpec.id), savedSpec];
    const updated = await updateCloneJob(id, {
      blueprint: { ...blueprint, variants, updatedAt: new Date().toISOString() },
    });
    return {
      plan: {
        ...plan,
        shots: renderedShots,
        timeline: finalTimeline,
        generationShotIndexes: [],
        voiceShotIndexes: [],
      },
      job: updated,
    };
  } finally {
    await cleanupCloneJobDirectory(id);
  }
}

async function runCloneReassembly(id: string) {
  if (runningJobs.has(id)) return await findCloneJob(id);
  runningJobs.add(id);
  try {
    const job = await findCloneJob(id);
    if (!job) throw new Error('克隆任务不存在');
    const referenceFile = await materializeReference(job);
    const probed = await probeMediaSeconds(referenceFile);
    const duration = round3(Math.min(probed || job.reference.seconds || 15, job.options.maxSeconds));
    if (!duration) throw new Error('参考视频时长读取失败，请重新导入后再试');
    const current = await updateCloneJob(id, {
      stage: 'assembling',
      progress: cloneStageProgress('assembling'),
      message: '正在按编辑后的时间轴重新合成',
      reference: { ...job.reference, seconds: duration },
    });
    if (!current) throw new Error('克隆任务已不存在');
    const publicState = await getPublicState();
    const timeline = await materializeReferenceAudioTrack(
      referenceFile,
      current.timeline.editorState
        ? timelineWithEditorState(current.timeline, normalizeVideoEditorState(current.timeline.editorState))
        : current.timeline,
      cloneJobDirectory(id),
    );
    const assembled = await assembleCloneVideo({
      job: { ...current, timeline },
      timeline,
      referenceFile,
      workingDirectory: path.join(cloneJobDirectory(id), 'assembly'),
      imageStoragePath: publicState.settings.imageStoragePath || '',
      videoStoragePath: publicState.settings.videoStoragePath || '',
      audioStoragePath: getDefaultAudioStoragePath(),
      onProgress: async (progress) => {
        await patchJob(id, {
          timeline,
          progress: round3(cloneStageProgress('assembling') + 0.94 * progress),
          message: `正在重新合成最终视频（${Math.round(progress * 100)}%）`,
        });
      },
    });
    if (assembled.warnings.length) await appendWarnings(id, assembled.warnings);
    const finalTimeline = { ...timeline, finalVideoUrl: assembled.url, finalVideoMime: assembled.mime };
    const finishedJob = await findCloneJob(id);
    const finished = await patchJob(id, {
      shots: current.shots,
      timeline: finalTimeline,
      stage: 'done',
      progress: 1,
      message: `已按编辑时间轴重新合成（${Math.round(finalTimeline.duration)} 秒）`,
      finishedAt: new Date().toISOString(),
      warnings: finishedJob?.warnings || current.warnings,
      error: undefined,
    });
    await cleanupCloneJobDirectory(id);
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : '本地重新合成失败';
    return await patchJob(id, { stage: 'failed', progress: 0, message, error: message, finishedAt: new Date().toISOString() });
  } finally {
    runningJobs.delete(id);
  }
}

function defaultShotStrategy(job: CloneJob, assetIds: string[]) {
  if (!assetIds.length) return job.capabilities.video ? 'text' as const : 'static' as const;
  if (job.capabilities.referenceImages) return 'reference' as const;
  if (job.capabilities.firstFrame) return 'keyframe' as const;
  return job.capabilities.video ? 'text' as const : 'static' as const;
}

function fallbackShotAssets(job: CloneJob, shot: CloneShot) {
  const lower = `${shot.visual} ${shot.prompt} ${shot.line}`.toLocaleLowerCase();
  const assets = job.assets || [];
  const find = (roles: CloneAsset['role'][]) => assets.filter((asset) => roles.includes(asset.role) && asset.kind === 'image').map((asset) => asset.nodeId || asset.url);
  const productWords = /产品|商品|瓶|包装|logo|品牌|product|package|logo/i;
  const personWords = /人|人物|主持|嘉宾|采访|近景|脸|person|host|speaker|portrait/i;
  if (productWords.test(lower)) return find(['product', 'brand']);
  if (personWords.test(lower)) return find(['person', 'scene']);
  return find(['scene', 'style', 'broll']);
}

/** 把全局素材变成镜头级依赖。模型只提出建议；无法判断时走可解释的保守规则，不把全部素材塞进每个镜头。 */
async function planShotDependencies(runtime: ChatRuntime, job: CloneJob, shots: CloneShot[]): Promise<CloneShot[]> {
  const validIds = new Set((job.assets || []).map((asset) => asset.nodeId || asset.url));
  const fallback = (shot: CloneShot) => {
    const assetIds = fallbackShotAssets(job, shot);
    const hasPerson = assetIds.some((id) => (job.assets || []).some((asset) => (asset.nodeId || asset.url) === id && asset.role === 'person'));
    const hasProduct = assetIds.some((id) => (job.assets || []).some((asset) => (asset.nodeId || asset.url) === id && asset.role === 'product'));
    if (hasPerson && shot.line) assetIds.push(...(job.assets || []).filter((asset) => asset.kind === 'audio' && asset.role === 'voice').map((asset) => asset.nodeId || asset.url));
    const uniqueAssetIds = [...new Set(assetIds)];
    return { ...shot, assetIds: uniqueAssetIds, strategy: defaultShotStrategy(job, uniqueAssetIds), speechMode: (hasPerson && Boolean(shot.line) ? 'talking' : shot.line ? 'narration' : 'silent') as CloneShotSpeechMode, preserveIdentity: hasPerson, preserveProduct: hasProduct };
  };
  if (!runtime || !job.assets?.length || !shots.length) return shots.map(fallback);
  const catalog = job.assets.map((asset) => `${asset.nodeId || asset.url} | ${asset.role} | ${asset.kind} | ${asset.name}`).join('\n');
  const shotList = shots.map((shot) => `${shot.index}: ${shot.visual} | ${shot.line}`).join('\n');
  try {
    const text = await askText(runtime, [{ role: 'system', content: SCRIPT_SYSTEM }, { role: 'user', content: [
      '为短视频镜头规划素材依赖。只能使用给出的素材 id；不确定时宁可留空，不要把所有素材分配给每个镜头。',
      '人物近景优先人物/场景；产品展示优先产品；品牌 CTA 优先品牌；声音素材只用于 talking 镜头。',
      '返回 JSON：{"shots":[{"index":0,"assetIds":["id"],"speechMode":"narration|talking|silent"}]}。',
      `素材：\n${catalog}`, `镜头：\n${shotList}`,
    ].join('\n') }]);
    const items = (parseJsonBlock(text) as { shots?: unknown[] } | null)?.shots;
    const byIndex = new Map<number, { assetIds: string[]; speechMode?: CloneShotSpeechMode }>();
    if (Array.isArray(items)) for (const item of items) {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const index = Number(value.index);
      const assetIds = Array.isArray(value.assetIds) ? value.assetIds.filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 8) : [];
      const speechMode = value.speechMode === 'talking' || value.speechMode === 'silent' || value.speechMode === 'narration' ? value.speechMode : undefined;
      if (Number.isInteger(index) && index >= 0) byIndex.set(index, { assetIds, speechMode });
    }
    return shots.map((shot) => {
      const suggested = byIndex.get(shot.index);
      if (!suggested) return fallback(shot);
      const assetIds = suggested.assetIds;
      const roles = assetIds.map((id) => (job.assets || []).find((asset) => (asset.nodeId || asset.url) === id)?.role);
      return { ...shot, assetIds, strategy: defaultShotStrategy(job, assetIds), speechMode: suggested.speechMode || (shot.line ? 'narration' : 'silent'), preserveIdentity: roles.includes('person'), preserveProduct: roles.includes('product') };
    });
  } catch {
    return shots.map(fallback);
  }
}

/** 将画布素材转换为图片编辑接口可接受的 data URL，避免把本地存储路径直接交给第三方。 */
async function cloneImageReferences(job: CloneJob, shot?: CloneShot) {
  const state = await getPublicState();
  const refs: string[] = [];
  if (shot?.referenceFrameUrl) refs.push(await cloneImageReference(job, shot.referenceFrameUrl));
  const selected = shot?.assetIds ? new Set(shot.assetIds) : null;
  for (const asset of (job.assets || []).filter((item) => item.kind === 'image' && (!selected || selected.has(item.nodeId || item.url))).slice(0, 8)) {
    const value = asset.url;
    if (value.startsWith('data:image/')) { refs.push(value); continue; }
    let file: string | null = null;
    if (value.startsWith('/api/storage/file')) {
      const name = new URL(value, 'http://localhost').searchParams.get('name') || '';
      file = resolveStoredFileWithFallback(state.settings.imageStoragePath || '', name);
    }
    if (file && existsSync(file)) {
      refs.push(`data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`);
      continue;
    }
    if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, { cache: 'no-store' });
      if (response.ok) refs.push(`data:${response.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`);
    }
  }
  return refs;
}

function cloneAudioReferences(job: CloneJob, shot: CloneShot) {
  const selected = new Set(shot.assetIds || []);
  return (job.assets || []).filter((asset) => asset.kind === 'audio' && selected.has(asset.nodeId || asset.url)).map((asset) => asset.url).slice(0, 3);
}

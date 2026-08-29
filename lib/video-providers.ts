import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedVideo, VideoGenerationInput } from './types';
import type { RuntimeProvider } from './providers';
import { is65535Provider, isAgnesProvider, requiresPublicMediaRelay } from './video-platform';

export type VideoProviderTask = {
  providerTaskId?: string;
  videoId?: string;
  model?: string;
  providerStatus?: string;
  progress?: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  videos: GeneratedVideo[];
  costUsd?: number;
  raw?: unknown;
  errorCode?: string;
  error?: string;
};

export class VideoProviderError extends Error {
  status?: number;
  code?: string;
  retryAfterMs?: number;
  constructor(message: string, options: { status?: number; code?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'VideoProviderError';
    Object.assign(this, options);
  }
}

function isAgnesVideoProvider(provider: RuntimeProvider) {
  return isAgnesProvider(provider) || provider.videoTransport === 'agnes-videos';
}

async function preparePublicMediaUrl(provider: RuntimeProvider, value: string, kind: 'image' | 'video' | 'audio') {
  const input = String(value || '').trim();
  if (!input || (/^https?:\/\//i.test(input) && !isLocalMediaUrl(input))) return input;
  if (!requiresPublicMediaRelay(provider, { hasVideoModel: true })) return input;
  return (await import('./signed-media')).preparePublicMediaUrl(input, kind);
}

function isLocalMediaUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.pathname === '/api/storage/file' || parsed.pathname === '/api/storage/video'
      || host === 'localhost' || host === '::1' || host === '0.0.0.0'
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
      || (host.startsWith('172.') && Number(host.split('.')[1]) >= 16 && Number(host.split('.')[1]) <= 31)
      || host.endsWith('.local');
  } catch { return true; }
}

function videoBaseUrl(provider: RuntimeProvider) {
  if (isAgnesVideoProvider(provider)) {
    if (provider.videoBaseUrl) {
      try { return new URL(provider.videoBaseUrl).origin; } catch { return provider.videoBaseUrl.replace(/\/+$/, ''); }
    }
    try { return new URL(provider.baseUrl).origin; } catch { return 'https://api.agnes-ai.cn'; }
  }
  return (provider.videoBaseUrl || (is65535Provider(provider) ? 'https://task-api-1-cn.65535.space' : provider.baseUrl)).replace(/\/+$/, '');
}

function endpoint(provider: RuntimeProvider, configured: string | undefined, fallback: string) {
  const value = String(configured || fallback).trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  const normalized = value.startsWith('/') ? value : `/${value}`;
  const base = videoBaseUrl(provider);
  return `${base}${/\/v1$/i.test(base) && /^\/v1(?:\/|$)/i.test(normalized) ? normalized.slice(3) || '/' : normalized}`;
}

function headers(provider: RuntimeProvider, idempotencyKey?: string) {
  const key = provider.videoApiKey || provider.apiKey;
  const name = provider.authHeader?.trim() || 'Authorization';
  const prefix = provider.authPrefix ?? 'Bearer ';
  return {
    [name]: `${prefix}${key}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function taskIdFrom(data: any) {
  const visit = (value: any, depth = 0): string => {
    if (depth > 10 || value === null || value === undefined || typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      for (const item of value) { const found = visit(item, depth + 1); if (found) return found; }
      return '';
    }
    for (const [key, item] of Object.entries(value)) {
      // Some 65535-compatible gateways return the asynchronous task handle
      // as a top-level `id` instead of `task_id`/`request_id`.
      const isTaskIdentifier = /^(submit_id|submitId|task_id|taskId|request_id|requestId)$/i.test(key)
        || (key === 'id' && depth <= 1);
      if (isTaskIdentifier && item !== undefined && item !== null && String(item).trim()) return String(item).trim();
      const found = visit(item, depth + 1);
      if (found) return found;
    }
    return '';
  };
  return visit(data);
}

function statusFrom(data: any): VideoProviderTask['status'] {
  const values: string[] = [];
  const visit = (value: any, depth = 0) => {
    if (depth > 10 || value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    for (const [key, item] of Object.entries(value)) {
      if (/^(status|state|gen_status|genStatus)$/i.test(key)) values.push(String(item).toLowerCase());
      visit(item, depth + 1);
    }
  };
  visit(data);
  const value = values.join(' ');
  if (/(done|success|succeed|completed|complete|finished|ready)/.test(value) || values.includes('50')) return 'done';
  if (/(fail|error|cancel|reject|expired|aborted)/.test(value)) return 'failed';
  if (/(running|processing|in_progress|generating)/.test(value)) return 'running';
  return 'pending';
}

function addVideo(value: unknown, output: GeneratedVideo[], seen: Set<string>, key = '', depth = 0) {
  if (depth > 9 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if ((/^https?:\/\//i.test(text) || /^data:video\//i.test(text)) && (/(video|result|output|download|url|file|uri|href)/i.test(key) || /^data:video\//i.test(text))) {
      if (!seen.has(text)) { seen.add(text); output.push({ url: text }); }
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => addVideo(item, output, seen, key, depth + 1)); return; }
  if (typeof value !== 'object') return;
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) addVideo(childValue, output, seen, childKey, depth + 1);
}

function videosFrom(data: any): GeneratedVideo[] {
  const output: GeneratedVideo[] = [];
  addVideo(data, output, new Set());
  return output;
}

function errorFrom(data: any, fallback: string) {
  const value = data?.error?.message || data?.error_message || data?.error || data?.message || data?.detail;
  return typeof value === 'string' ? value.slice(0, 900) : value ? JSON.stringify(value).slice(0, 900) : fallback;
}

function jimengErrorCode(value: unknown) {
  const text = String(value ?? '');
  if (/AigcComplianceConfirmationRequired/i.test(text)) return 'JIMENG_FIRST_USE_REQUIRED';
  if (/(insufficient|not enough|credit|积分|点数).*(balance|credit|enough|不足)|余额不足|积分不足/i.test(text)) return 'JIMENG_CREDIT_INSUFFICIENT';
  if (/(login required|not logged[ -]?in|unauthorized|session expired|未登录|登录失效|授权失效)/i.test(text)) return 'JIMENG_AUTH_REQUIRED';
  if (/timed? out|timeout|超时/i.test(text)) return 'JIMENG_TIMEOUT';
  return undefined;
}

function jimengErrorMessage(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  const code = jimengErrorCode(text);
  if (code === 'JIMENG_FIRST_USE_REQUIRED') return '即梦要求先在即梦网页端使用该模型完成一次生成，请先完成首次生成后再回来重试。';
  if (code === 'JIMENG_CREDIT_INSUFFICIENT') return '即梦账户积分不足，请到即梦账户充值或更换账户后重试。';
  if (code === 'JIMENG_AUTH_REQUIRED') return '即梦登录已失效，请到设置中重新授权即梦 CLI。';
  if (code === 'JIMENG_TIMEOUT') return '即梦任务查询超时，任务可能仍在生成，请稍后刷新任务状态。';
  return text.slice(0, 900) || fallback;
}

async function requestJson(url: string, init: RequestInit, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new VideoProviderError(error instanceof Error ? error.message : '视频服务商连接失败');
  }
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    let data: any = {};
    try { data = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch {}
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    throw new VideoProviderError(errorFrom(data, `视频服务商返回 HTTP ${response.status}`), { status: response.status, retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : undefined });
  }
  if (/^video\//i.test(contentType) && bytes.byteLength <= 64 * 1024 * 1024) return { data: `data:${contentType.split(';', 1)[0]};base64,${Buffer.from(bytes).toString('base64')}` };
  const text = Buffer.from(bytes).toString('utf8');
  try { return { data: text ? JSON.parse(text) : {} }; } catch { throw new VideoProviderError('视频服务商返回了无法解析的结果'); }
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('视频请求已取消'));
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new Error('视频请求已取消'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function videoRateLimitMessage(error: VideoProviderError) {
  const detail = error.message || '';
  const allowance = detail.match(/allows?\s+(\d+)\s+requests?\s+per\s+(\d+)\s+minute/i);
  if (allowance) {
    const count = Number(allowance[1]);
    const minutes = Number(allowance[2]);
    const waitSeconds = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : minutes * 60;
    return `视频服务商已限流：当前账号每 ${minutes} 分钟最多生成 ${count} 个视频，请等待约 ${waitSeconds} 秒后再试。`;
  }
  if (error.retryAfterMs) return `视频服务商已限流，请等待约 ${Math.ceil(error.retryAfterMs / 1000)} 秒后再试。`;
  return '视频服务商暂时限流（HTTP 429），请稍后再试。';
}

/**
 * A submission-level 429 should not be retried blindly. Agnes deliberately
 * enforces one video request per minute, so a short exponential retry only
 * creates more rejected requests and hides the real cause from the user.
 */
async function requestJsonWithRateLimitRetry(url: string, init: RequestInit, signal?: AbortSignal, options: { retry429?: boolean } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJson(url, init, signal);
    } catch (error) {
      const providerError = error instanceof VideoProviderError ? error : null;
      if (!providerError || providerError.status !== 429) throw error;
      if (options.retry429 === false) {
        throw new VideoProviderError(videoRateLimitMessage(providerError), {
          status: providerError.status,
          retryAfterMs: providerError.retryAfterMs,
          code: 'VIDEO_RATE_LIMITED',
        });
      }
      if (attempt >= 3) throw error;
      const backoff = providerError.retryAfterMs || Math.min(10_000, 1000 * 2 ** attempt);
      await waitForRetry(backoff, signal);
    }
  }
}

function videoReferenceValues(input: VideoGenerationInput) {
  return input.referenceVideos?.length ? input.referenceVideos : input.referenceVideo ? [input.referenceVideo] : [];
}

function audioValues(input: VideoGenerationInput) {
  return input.audios?.length ? input.audios : input.audio ? [input.audio] : [];
}

async function prepareRemoteVideoMedia(provider: RuntimeProvider, input: VideoGenerationInput) {
  const [firstFrame, lastFrame, referenceImages, referenceVideos, audios] = await Promise.all([
    input.firstFrame ? preparePublicMediaUrl(provider, input.firstFrame, 'image') : undefined,
    input.lastFrame ? preparePublicMediaUrl(provider, input.lastFrame, 'image') : undefined,
    Promise.all((input.referenceImages || []).map((url) => preparePublicMediaUrl(provider, url, 'image'))),
    Promise.all(videoReferenceValues(input).map((url) => preparePublicMediaUrl(provider, url, 'video'))),
    Promise.all(audioValues(input).map((url) => preparePublicMediaUrl(provider, url, 'audio'))),
  ]);
  return {
    ...input,
    firstFrame,
    lastFrame,
    referenceImages,
    ...(referenceVideos.length ? { referenceVideos, referenceVideo: referenceVideos[0] } : {}),
    ...(audios.length ? { audios, audio: audios[0] } : {}),
  };
}

function inputPayload(input: VideoGenerationInput) {
  const referenceVideos = videoReferenceValues(input);
  const audios = audioValues(input);
  const firstFrame = String(input.firstFrame || '').trim();
  const lastFrame = String(input.lastFrame || '').trim();
  const referenceImageUrls = Array.from(new Set([
    ...(input.referenceImages || []),
    firstFrame,
    lastFrame,
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  // 65535's native schema has no `frames` mode. A single image is a genuine
  // first-frame request; two frame images are sent as references so the
  // upstream API receives one of its documented input modes.
  const inputMode = firstFrame && !lastFrame && referenceImageUrls.length === 1
    ? 'first_frame'
    : referenceImageUrls.length
      ? 'reference'
      : undefined;
  return {
    prompt: input.prompt,
    seconds: input.seconds,
    aspect_ratio: input.aspectRatio === 'auto' ? undefined : input.aspectRatio,
    resolution: input.resolution,
    input_mode: inputMode,
    input_reference: inputMode === 'first_frame' ? { image_url: firstFrame } : undefined,
    reference_image_urls: inputMode === 'reference' ? referenceImageUrls : [],
    video: referenceVideos.length > 1 ? referenceVideos : referenceVideos[0],
    audio_urls: audios,
  };
}

function openAiPayload(model: string, input: VideoGenerationInput) {
  const referenceVideos = videoReferenceValues(input);
  const audios = audioValues(input);
  return {
    model,
    prompt: input.prompt,
    duration: input.seconds,
    seconds: input.seconds,
    aspect_ratio: input.aspectRatio === 'auto' ? undefined : input.aspectRatio,
    resolution: input.resolution,
    operation: input.operation || 'generate',
    first_frame: input.firstFrame,
    last_frame: input.lastFrame,
    reference_images: input.referenceImages || [],
    reference_video: referenceVideos.length > 1 ? referenceVideos : referenceVideos[0],
    audio: audios.length > 1 ? audios : audios[0],
  };
}

const AGNES_VIDEO_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2']);

function agnesPrompt(prompt: string) {
  return String(prompt || '').replace(/@(\d+)\b/g, '<Picture $1>');
}

function agnesDimensions(input: VideoGenerationInput) {
  const explicitWidth = Number(input.width);
  const explicitHeight = Number(input.height);
  if (Number.isInteger(explicitWidth) && explicitWidth > 0 && Number.isInteger(explicitHeight) && explicitHeight > 0) return { width: explicitWidth, height: explicitHeight };
  const ratio = input.aspectRatio;
  const presets: Record<string, { width: number; height: number }> = {
    // V2.0 requires both dimensions to be multiples of 64. These presets
    // preserve the requested aspect ratios while staying inside that rule.
    '21:9': { width: 1792, height: 768 }, '16:9': { width: 1024, height: 576 }, '4:3': { width: 1024, height: 768 },
    '1:1': { width: 768, height: 768 }, '3:4': { width: 768, height: 1024 }, '9:16': { width: 576, height: 1024 },
  };
  return presets[ratio || '16:9'] || presets['16:9'];
}

function agnesV20SizeMapping(width: number, height: number) {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const standard = longEdge <= 854 || shortEdge <= 480 ? '480p' : longEdge <= 1280 || shortEdge <= 720 ? '720p' : '1080p';
  return { requested: `${width}x${height}`, normalized: standard, width, height };
}

function validateAgnesV20Dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 3840 || height > 3840 || width % 64 !== 0 || height % 64 !== 0) {
    throw new VideoProviderError('Agnes Video V2.0 的宽度和高度必须是 64 的倍数，范围为 64–3840。', { code: 'AGNES_INVALID_DIMENSIONS' });
  }
}

export function buildAgnesVideoPayload(rawModelId: string, input: VideoGenerationInput, media: { firstFrame?: string; lastFrame?: string; referenceImages?: string[]; referenceVideos?: string[]; audios?: string[] } = {}) {
  const model = String(rawModelId || '').trim();
  const images = media.referenceImages || input.referenceImages || [];
  const videos = media.referenceVideos || videoReferenceValues(input);
  const audios = media.audios || audioValues(input);
  const isV20 = /agnes-video-v2\.0/i.test(model);
  if (isV20) {
    if (videos.length || audios.length) throw new VideoProviderError('Agnes Video V2.0 不接受参考视频或音频输入。', { code: 'AGNES_UNSUPPORTED_MEDIA' });
    const { width, height } = agnesDimensions(input);
    validateAgnesV20Dimensions(width, height);
    const numFrames = Number(input.numFrames ?? 81);
    const frameRate = Number(input.frameRate ?? 24);
    if (!Number.isInteger(numFrames) || numFrames < 1 || numFrames > 441 || (numFrames - 1) % 8 !== 0) throw new VideoProviderError('Agnes Video V2.0 的 num_frames 必须不超过 441 且满足 8n + 1。', { code: 'AGNES_INVALID_NUM_FRAMES' });
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 60) throw new VideoProviderError('Agnes Video V2.0 的 frame_rate 必须在 1–60 之间。', { code: 'AGNES_INVALID_FRAME_RATE' });
    const extraBody: Record<string, unknown> = {};
    let image: string | string[] | undefined;
    if (input.videoMode === 'keyframe' || input.lastFrame) {
      const keyframes = [media.firstFrame || input.firstFrame, media.lastFrame || input.lastFrame].filter(Boolean);
      if (!keyframes.length) throw new VideoProviderError('Agnes Video V2.0 关键帧模式至少需要一张首帧或尾帧图片。', { code: 'AGNES_KEYFRAME_REQUIRED' });
      extraBody.image = keyframes;
      extraBody.mode = 'keyframes';
    } else if (media.firstFrame || input.firstFrame || images.length) {
      image = media.firstFrame || input.firstFrame || (images.length === 1 ? images[0] : images);
    }
    return {
      model,
      prompt: agnesPrompt(input.prompt),
      width,
      height,
      num_frames: numFrames,
      frame_rate: frameRate,
      metadata: { size_mapping: agnesV20SizeMapping(width, height) },
      ...(image ? { image } : {}),
      ...(Object.keys(extraBody).length ? { extra_body: extraBody } : {}),
    };
  }

  const flash = /agnes-video-2\.5-flash/i.test(model);
  const seconds = String(Number(input.seconds || 5));
  const secondsNumber = Number(seconds);
  if (!Number.isInteger(secondsNumber) || secondsNumber < 4 || secondsNumber > 12) throw new VideoProviderError('Agnes Video 2.5 系列仅支持 4–12 秒。', { code: 'AGNES_INVALID_SECONDS' });
  const size = flash ? '720P' : String(input.videoSize || input.resolution || '720P').toUpperCase();
  if (!flash && !['720P', '960P', '2K'].includes(size)) throw new VideoProviderError('Agnes Video 2.5 仅支持 720P、960P、2K。', { code: 'AGNES_INVALID_SIZE' });
  if (flash && size !== '720P') throw new VideoProviderError('Agnes Video 2.5 Flash 固定使用 720P。', { code: 'AGNES_INVALID_SIZE' });
  if (flash && images.length > 5) throw new VideoProviderError('Agnes Video 2.5 Flash 最多接收 5 张参考图片。', { code: 'AGNES_REFERENCE_IMAGE_LIMIT' });
  if (flash && videos.length) throw new VideoProviderError('Agnes Video 2.5 Flash 不支持参考视频。', { code: 'AGNES_REFERENCE_VIDEO_UNSUPPORTED' });
  const mode = input.videoMode || (input.firstFrame || input.lastFrame ? 'keyframe' : images.length || videos.length || audios.length ? 'reference' : 'text');
  if (!['text', 'keyframe', 'reference'].includes(mode)) throw new VideoProviderError('Agnes Video 2.5 的 mode 必须为 text、keyframe 或 reference。', { code: 'AGNES_INVALID_MODE' });
  const hasFirstFrame = Boolean(input.firstFrame || media.firstFrame);
  const hasLastFrame = Boolean(input.lastFrame || media.lastFrame);
  if (mode === 'text' && (hasFirstFrame || hasLastFrame || images.length || videos.length || audios.length)) throw new VideoProviderError('Agnes text 模式不允许首尾帧、参考图片、参考视频或音频输入。', { code: 'AGNES_TEXT_MEDIA_NOT_ALLOWED' });
  if (mode === 'keyframe' && !hasFirstFrame && !hasLastFrame) throw new VideoProviderError('Agnes keyframe 模式至少需要 first_frame 或 last_frame。', { code: 'AGNES_KEYFRAME_REQUIRED' });
  if (mode === 'keyframe' && (images.length || videos.length || audios.length)) throw new VideoProviderError('Agnes keyframe 模式不允许参考图片、参考视频或音频输入。', { code: 'AGNES_KEYFRAME_MEDIA_NOT_ALLOWED' });
  if (mode === 'reference' && (hasFirstFrame || hasLastFrame)) throw new VideoProviderError('Agnes reference 模式不允许 first_frame 或 last_frame。', { code: 'AGNES_REFERENCE_FRAME_NOT_ALLOWED' });
  if (mode === 'reference' && !images.length && !videos.length && !audios.length) throw new VideoProviderError('Agnes reference 模式至少需要图片、音频或视频参考输入。', { code: 'AGNES_REFERENCE_REQUIRED' });
  const ratio = AGNES_VIDEO_RATIOS.has(String(input.aspectRatio || '')) ? input.aspectRatio : undefined;
  const referenceVideos = videos.map((url) => ({ url, ...(input.referenceVideoStartSeconds !== undefined ? { start_seconds: input.referenceVideoStartSeconds } : {}), ...(input.referenceVideoEndSeconds !== undefined ? { end_seconds: input.referenceVideoEndSeconds } : {}), ...(input.requireAudio !== undefined ? { require_audio: input.requireAudio } : {}) }));
  return {
    model,
    prompt: agnesPrompt(input.prompt),
    seconds,
    size,
    mode,
    ...(ratio ? { aspect_ratio: ratio } : {}),
    ...(mode === 'keyframe' ? {
      ...(media.firstFrame || input.firstFrame ? { first_frame: media.firstFrame || input.firstFrame } : {}),
      ...(media.lastFrame || input.lastFrame ? { last_frame: media.lastFrame || input.lastFrame } : {}),
    } : {}),
    ...(mode === 'reference' ? {
      ...(images.length ? { images: images.map((url) => ({ url })) } : {}),
      ...(audios.length ? { audios: audios.map((url) => ({ url })) } : {}),
      ...(referenceVideos.length ? { videos: referenceVideos } : {}),
    } : {}),
  };
}

function agnesResponseValue(data: any, key: string) {
  return data?.[key]
    ?? data?.data?.[key]
    ?? data?.result?.[key]
    ?? data?.data?.result?.[key]
    ?? data?.result?.data?.[key];
}

function agnesVideoIdFrom(data: any) {
  const candidates = [
    agnesResponseValue(data, 'video_id'),
    agnesResponseValue(data, 'task_id'),
    agnesResponseValue(data, 'id'),
  ];
  return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim()) || '').trim();
}

function agnesStatusFrom(data: any): VideoProviderTask['status'] {
  const status = String(agnesResponseValue(data, 'status') ?? agnesResponseValue(data, 'state') ?? '').toLowerCase();
  if (/^(completed?|complete|done|success(?:ful|ed)?|succeed(?:ed)?|finished|ready)$/i.test(status)) return 'done';
  if (/failed|error|cancel|rejected|expired|aborted/.test(status)) return 'failed';
  if (/running|processing|generating|in_progress/.test(status)) return 'running';
  return 'pending';
}

function agnesVideosFrom(data: any): GeneratedVideo[] {
  const output: GeneratedVideo[] = [];
  const seen = new Set<string>();
  const urlKey = /^(?:url|uri|href|video[_-]?urls?|download[_-]?urls?|file[_-]?urls?|remixed_from_video_id)$/i;
  const add = (value: unknown, key: string) => {
    if (typeof value !== 'string') return;
    const url = value.trim();
    if (!(/^(?:https?:\/\/|data:video\/)/i.test(url)) || !(urlKey.test(key) || !key) || seen.has(url)) return;
    seen.add(url);
    output.push({ url });
  };
  const visit = (value: unknown, key = '', depth = 0) => {
    if (depth > 10 || value === null || value === undefined) return;
    if (typeof value === 'string') return add(value, key);
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key, depth + 1));
    if (typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) visit(childValue, childKey, depth + 1);
  };
  visit(data);
  return output;
}

function agnesErrorFrom(data: any) {
  const value = data?.error?.message || data?.data?.error?.message || data?.error || data?.message;
  return typeof value === 'string' ? value.slice(0, 900) : value ? JSON.stringify(value).slice(0, 900) : 'Agnes 视频任务失败';
}

function agnesProgressFrom(data: any) {
  const value = agnesResponseValue(data, 'progress');
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function agnesQueryUrl(provider: RuntimeProvider, videoId: string, rawModelId?: string) {
  const configured = provider.videoQueryPath || '/agnesapi';
  const base = videoBaseUrl(provider);
  const url = /^https?:\/\//i.test(configured) ? new URL(configured) : new URL(`${base}${configured.startsWith('/') ? configured : `/${configured}`}`);
  url.searchParams.set('video_id', videoId);
  if (/agnes-video-2\.5/i.test(rawModelId || '')) url.searchParams.set('model_name', rawModelId || '');
  return url.toString();
}

function agnesGenerationUrl(provider: RuntimeProvider) {
  const configured = provider.videoGenerationPath || '/v1/videos';
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, '');
  return `${videoBaseUrl(provider)}${configured.startsWith('/') ? configured : `/${configured}`}`;
}

async function submitAgnesVideo(provider: RuntimeProvider, rawModelId: string, input: VideoGenerationInput, idempotencyKey: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const media = {
    firstFrame: input.firstFrame ? await preparePublicMediaUrl(provider, input.firstFrame, 'image') : undefined,
    lastFrame: input.lastFrame ? await preparePublicMediaUrl(provider, input.lastFrame, 'image') : undefined,
    referenceImages: await Promise.all((input.referenceImages || []).map((url) => preparePublicMediaUrl(provider, url, 'image'))),
    referenceVideos: await Promise.all(videoReferenceValues(input).map((url) => preparePublicMediaUrl(provider, url, 'video'))),
    audios: await Promise.all(audioValues(input).map((url) => preparePublicMediaUrl(provider, url, 'audio'))),
  };
  const body = buildAgnesVideoPayload(rawModelId, input, media);
  const response = await requestJsonWithRateLimitRetry(agnesGenerationUrl(provider), { method: 'POST', headers: headers(provider, idempotencyKey), body: JSON.stringify(body) }, signal, { retry429: false });
  const data = response.data;
  const videoId = agnesVideoIdFrom(data);
  const status = agnesStatusFrom(data);
  const videos = status === 'done' ? agnesVideosFrom(data) : [];
  const providerStatus = String(agnesResponseValue(data, 'status') || '').trim() || undefined;
  const progress = agnesProgressFrom(data);
  if (status === 'failed') return { providerTaskId: videoId || undefined, videoId: videoId || undefined, model: rawModelId, providerStatus, progress, status, videos, raw: data, error: agnesErrorFrom(data), errorCode: 'AGNES_VIDEO_FAILED' };
  if (!videos.length && !videoId) throw new VideoProviderError('Agnes 视频接口已响应，但没有返回 video_id、task_id 或 id。', { code: 'AGNES_VIDEO_ID_MISSING' });
  return { providerTaskId: videoId || undefined, videoId: videoId || undefined, model: rawModelId, providerStatus, progress, status, videos, raw: data };
}

async function pollAgnesVideo(provider: RuntimeProvider, videoId: string, rawModelId?: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const response = await requestJson(agnesQueryUrl(provider, videoId, rawModelId), { method: 'GET', headers: headers(provider) }, signal);
  const data = response.data;
  const status = agnesStatusFrom(data);
  const videos = status === 'done' ? agnesVideosFrom(data) : [];
  return { providerTaskId: videoId, videoId, model: rawModelId, providerStatus: String(agnesResponseValue(data, 'status') || '').trim() || undefined, progress: agnesProgressFrom(data), status, videos, raw: data, ...(status === 'failed' ? { error: agnesErrorFrom(data), errorCode: 'AGNES_VIDEO_FAILED' } : {}) };
}

export async function submitRemoteVideo(provider: RuntimeProvider, rawModelId: string, input: VideoGenerationInput, idempotencyKey: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  if (isAgnesVideoProvider(provider)) return submitAgnesVideo(provider, rawModelId, input, idempotencyKey, signal);
  const transport = resolveVideoTransport(provider);
  const preparedInput = transport === 'openai-videos' && requiresPublicMediaRelay(provider, { hasVideoModel: true })
    ? await prepareRemoteVideoMedia(provider, input)
    : input;
  const url = transport === 'native-task' ? endpoint(provider, provider.videoTaskPath, '/v1/tasks') : endpoint(provider, provider.videoGenerationPath, '/v1/videos');
  const body = transport === 'native-task'
    ? { kind: 'video', model: rawModelId, operation: preparedInput.operation || 'generate', input: inputPayload(preparedInput) }
    : openAiPayload(rawModelId, preparedInput);
  const response = await requestJsonWithRateLimitRetry(url, { method: 'POST', headers: headers(provider, idempotencyKey), body: JSON.stringify(body) }, signal, { retry429: false });
  const data = response.data;
  const videos = videosFrom(data);
  const providerTaskId = taskIdFrom(data);
  const status = videos.length ? 'done' : statusFrom(data);
  if (status === 'failed') return { providerTaskId, status, videos, error: errorFrom(data, '视频任务失败'), raw: data };
  if (!videos.length && !providerTaskId) throw new VideoProviderError('视频接口已响应，但没有返回视频地址或任务编号');
  return { providerTaskId: providerTaskId || undefined, status: videos.length ? 'done' : status, videos, costUsd: Number(data?.cost_usd || data?.costUsd || data?.data?.cost_usd || 0) || undefined, raw: data };
}

export async function pollRemoteVideo(provider: RuntimeProvider, providerTaskId: string, signal?: AbortSignal, rawModelId?: string): Promise<VideoProviderTask> {
  if (isAgnesVideoProvider(provider)) return pollAgnesVideo(provider, providerTaskId, rawModelId, signal);
  const transport = resolveVideoTransport(provider);
  // Old configurations stored /v1/tasks/{id} for every provider. In auto
  // mode that value must not override the standard OpenAI-compatible status
  // endpoint; explicit transports and custom paths remain authoritative.
  const configured = provider.videoTaskStatusPath && !(provider.videoTransport === 'auto' && !is65535Provider(provider) && provider.videoTaskStatusPath.replaceAll('{taskId}', '{id}').replaceAll('{task_id}', '{id}') === '/v1/tasks/{id}')
    ? provider.videoTaskStatusPath
    : (transport === 'native-task' ? '/v1/tasks/{id}' : '/v1/videos/{id}');
  if (!configured) throw new VideoProviderError('未配置视频任务查询地址');
  const pathValue = configured.replaceAll('{id}', encodeURIComponent(providerTaskId)).replaceAll('{taskId}', encodeURIComponent(providerTaskId)).replaceAll('{task_id}', encodeURIComponent(providerTaskId));
  const url = endpoint(provider, pathValue, pathValue);
  const response = await requestJson(url, { method: 'GET', headers: headers(provider) }, signal);
  const data = response.data;
  const videos = videosFrom(data);
  const status = videos.length ? 'done' : statusFrom(data);
  return { providerTaskId, status, videos, costUsd: Number(data?.cost_usd || data?.costUsd || data?.data?.cost_usd || 0) || undefined, raw: data, ...(status === 'failed' ? { error: errorFrom(data, '视频任务失败') } : {}) };
}

export function resolveVideoTransport(provider: Pick<RuntimeProvider, 'videoTransport' | 'platform' | 'baseUrl' | 'videoBaseUrl'>): 'native-task' | 'openai-videos' {
  if (provider.videoTransport === 'native-task' || provider.videoTransport === 'openai-videos') return provider.videoTransport;
  return is65535Provider(provider as RuntimeProvider) ? 'native-task' : 'openai-videos';
}

function jimengCliShell(command: string) { return process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'); }
function cliCommand(provider: RuntimeProvider) {
  const profile = process.env.USERPROFILE || os.homedir();
  const candidates = [provider.jimengCliPath, process.env.JIMENG_CLI_PATH, path.join(profile, 'bin', 'dreamina.exe'), path.join(profile, 'bin', 'dreamina.cmd'), path.join(profile, '.local', 'bin', 'dreamina.exe'), path.join(profile, '.local', 'bin', 'dreamina.cmd'), process.platform === 'win32' ? 'dreamina.exe' : 'dreamina', process.platform === 'win32' ? 'dreamina.cmd' : 'dreamina'].map((value) => String(value || '').trim()).filter(Boolean);
  return candidates.find((value) => path.isAbsolute(value) ? existsSync(value) : value === provider.jimengCliPath || value === process.env.JIMENG_CLI_PATH || /^(dreamina)(\.exe|\.cmd)?$/i.test(value)) || candidates[0] || 'dreamina';
}

export type JimengVideoCommand = 'text2video' | 'image2video' | 'frames2video' | 'multiframe2video' | 'multimodal2video';

export function jimengModelVersion(rawId?: string) {
  const value = String(rawId || '').trim().toLowerCase();
  if (!value || value === 'auto' || value === 'jimeng-cli-video') return undefined;
  if (/seedance[-_. ]?2\.5/.test(value)) return 'seedance2.5';
  if (/seedance[-_. ]?2\.0.*mini|seedance[-_. ]?2\.0mini/.test(value)) return 'seedance2.0mini';
  if (/seedance[-_. ]?2\.0.*fast.*vip|seedance[-_. ]?2\.0fastvip/.test(value)) return 'seedance2.0fast_vip';
  if (/seedance[-_. ]?2\.0.*vip|seedance[-_. ]?2\.0vip/.test(value)) return 'seedance2.0_vip';
  if (/seedance[-_. ]?2\.0.*fast|seedance[-_. ]?2\.0fast/.test(value)) return 'seedance2.0fast';
  if (/seedance[-_. ]?2\.0/.test(value)) return 'seedance2.0';
  return String(rawId || '').trim() || undefined;
}

export function jimengVideoCommand(input: VideoGenerationInput): JimengVideoCommand {
  const referenceCount = input.referenceImages?.length || 0;
  if (videoReferenceValues(input).length || audioValues(input).length) return 'multimodal2video';
  if (input.firstFrame && input.lastFrame) return 'frames2video';
  if (referenceCount > 1) return 'multiframe2video';
  if (input.firstFrame || referenceCount === 1) return 'image2video';
  return 'text2video';
}

/**
 * Build the official Dreamina CLI argument array. Keep each subcommand's
 * flags explicit because the CLI intentionally uses different names for a
 * single image, first/last frames, and multimodal inputs.
 */
export function buildJimengCliArgs(input: VideoGenerationInput, rawModelId?: string) {
  const command = jimengVideoCommand(input);
  const args: string[] = [command];
  const add = (flag: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && String(value).trim()) args.push(flag, String(value));
  };
  const modelVersion = jimengModelVersion(rawModelId);

  switch (command) {
    case 'text2video':
      add('--model_version', modelVersion);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--ratio', input.aspectRatio);
      add('--video_resolution', input.resolution);
      break;
    case 'image2video':
      add('--model_version', modelVersion);
      add('--image', input.firstFrame || input.referenceImages?.[0]);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--video_resolution', input.resolution);
      break;
    case 'frames2video':
      add('--model_version', modelVersion);
      add('--first', input.firstFrame);
      add('--last', input.lastFrame);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--video_resolution', input.resolution);
      break;
    case 'multiframe2video':
      // This command has a fixed backend model: it does not accept
      // --model_version or --ratio. Its --images flag is one comma-separated
      // list, and 3+ images require one transition prompt per segment.
      add('--images', (input.referenceImages || []).filter(Boolean).join(','));
      if ((input.referenceImages || []).length <= 2) {
        add('--prompt', input.prompt);
        add('--duration', input.seconds);
      } else {
        for (let index = 1; index < (input.referenceImages || []).length; index += 1) add('--transition-prompt', input.prompt);
      }
      add('--video_resolution', input.resolution);
      break;
    case 'multimodal2video':
      add('--model_version', modelVersion);
      add('--image', input.firstFrame || input.referenceImages?.[0]);
      for (const video of videoReferenceValues(input)) add('--video', video);
      for (const audio of audioValues(input)) add('--audio', audio);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--ratio', input.aspectRatio);
      add('--video_resolution', input.resolution);
      break;
  }
  return args;
}

// Kept local as an alias for older callers while tests and integrations use
// the descriptive exported name above.
function cliArgs(input: VideoGenerationInput, rawModelId?: string) { return buildJimengCliArgs(input, rawModelId); }

function parseCliJsonValues(output: string) {
  const values: any[] = [];
  const trimmed = output.trim();
  if (trimmed) {
    try { values.push(JSON.parse(trimmed)); } catch {}
  }
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(parsed))) values.push(parsed);
    } catch {}
  }
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(parsed))) values.push(parsed);
    } catch {}
  }
  return values;
}

export function parseJimengCliVideoOutput(output: string) {
  const values = parseCliJsonValues(output);
  const videos: GeneratedVideo[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const video of videosFrom(value)) {
      if (!seen.has(video.url)) { seen.add(video.url); videos.push(video); }
    }
  }
  const url = output.match(/https?:\/\/[^\s"']+\.(?:mp4|webm|mov)(?:\?[^\s"']*)?/i)?.[0];
  if (url && !seen.has(url)) videos.push({ url });
  const parsed = values.slice().reverse().find((value) => videosFrom(value).length || taskIdFrom(value) || statusFrom(value) !== 'pending') || values[values.length - 1] || { raw: output };
  const status = statusFrom(parsed);
  const error = errorFrom(parsed, '');
  return { parsed, videos, taskId: values.map((value) => taskIdFrom(value)).find(Boolean) || '', status, error: status === 'failed' ? error : '' };
}

function runJimengVideoCli(command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  return new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: jimengCliShell(command) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      try { child.kill(); } catch {}
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new VideoProviderError('即梦 CLI 任务已取消。', { code: 'JIMENG_ABORTED' }));
      }
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: 0, stdout, stderr, timedOut: true });
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new VideoProviderError(`无法启动即梦 CLI：${error.message}`, { code: 'JIMENG_CLI_START_FAILED' }));
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr, timedOut: false }));
  });
}

function videoMime(file: string) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.webm' ? 'video/webm' : extension === '.mov' ? 'video/quicktime' : extension === '.ogv' ? 'video/ogg' : 'video/mp4';
}

async function downloadedVideoFiles(directory: string): Promise<GeneratedVideo[]> {
  const files: string[] = [];
  const visit = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:mp4|webm|mov|ogv|m4v)$/i.test(entry.name)) files.push(file);
    }
  };
  await visit(directory);
  return Promise.all(files.map(async (file) => ({ url: `data:${videoMime(file)};base64,${(await readFile(file)).toString('base64')}` })));
}

export async function runJimengVideo(provider: RuntimeProvider, rawModelId: string, input: VideoGenerationInput, signal?: AbortSignal): Promise<VideoProviderTask> {
  const command = cliCommand(provider);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-'));
  const tempFiles: string[] = [];
  const materialize = async (value: string | undefined, name: string) => {
    if (!value || !value.startsWith('data:')) return value;
    const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new VideoProviderError('即梦 CLI 输入文件格式无效');
    const ext = String(match[1] || 'application/octet-stream').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const file = path.join(tempDir, `${name}.${ext}`);
    const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    await writeFile(file, bytes, { flag: 'wx' });
    tempFiles.push(file);
    return file;
  };
  try {
    const referenceVideoInputs = videoReferenceValues(input);
    const audioInputs = audioValues(input);
    const referenceVideos = await Promise.all(referenceVideoInputs.map((item, index) => materialize(item, `reference-video-${index + 1}`) as Promise<string>));
    const audios = await Promise.all(audioInputs.map((item, index) => materialize(item, `audio-${index + 1}`) as Promise<string>));
    const cliInput: VideoGenerationInput = {
      ...input,
      firstFrame: await materialize(input.firstFrame, 'first-frame'),
      lastFrame: await materialize(input.lastFrame, 'last-frame'),
      referenceVideos,
      referenceVideo: referenceVideos[0],
      audios,
      audio: audios[0],
      referenceImages: await Promise.all((input.referenceImages || []).map((item, index) => materialize(item, `reference-${index + 1}`) as Promise<string>)),
    };
    const args = [...cliArgs(cliInput, rawModelId), '--poll', '0'];
    const output = await runJimengVideoCli(command, args, 120_000, signal);
    if (output.timedOut) throw new VideoProviderError('即梦视频提交超时，请稍后在任务列表刷新状态。', { code: 'JIMENG_TIMEOUT' });
    if (output.code !== 0) {
      const message = jimengErrorMessage(output.stderr.trim() || output.stdout.trim(), '即梦 CLI 视频生成失败');
      throw new VideoProviderError(message, { code: jimengErrorCode(message) });
    }
    const parsed = parseJimengCliVideoOutput(`${output.stdout}\n${output.stderr}`);
    if (parsed.status === 'failed') return { providerTaskId: parsed.taskId || undefined, status: 'failed', videos: [], raw: parsed.parsed, error: jimengErrorMessage(parsed.error, '即梦视频任务失败'), errorCode: jimengErrorCode(parsed.error) };
    if (!parsed.videos.length && !parsed.taskId) throw new VideoProviderError('即梦 CLI 已完成，但没有解析到视频地址；请检查 CLI 输出格式');
    return { providerTaskId: parsed.taskId || undefined, status: parsed.videos.length ? 'done' : 'pending', videos: parsed.videos, raw: parsed.parsed };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function pollJimengVideo(provider: RuntimeProvider, providerTaskId: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const command = cliCommand(provider);
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-result-'));
  try {
    const downloadedOutput = await runJimengVideoCli(command, ['query_result', `--submit_id=${providerTaskId}`, `--download_dir=${outputDirectory}`], 120_000, signal);
    if (downloadedOutput.timedOut) return { providerTaskId, status: 'pending', videos: [], raw: { timedOut: true } };
    const parsed = parseJimengCliVideoOutput(`${downloadedOutput.stdout}\n${downloadedOutput.stderr}`);
    const downloadedVideos = await downloadedVideoFiles(outputDirectory);
    if (downloadedVideos.length) return { providerTaskId, status: 'done', videos: downloadedVideos, raw: parsed.parsed };
    if (parsed.videos.length) return { providerTaskId, status: 'done', videos: parsed.videos, raw: parsed.parsed };
    if (downloadedOutput.code !== 0) {
      const message = jimengErrorMessage(downloadedOutput.stderr.trim() || downloadedOutput.stdout.trim(), '即梦 CLI 查询视频结果失败');
      throw new VideoProviderError(message, { code: jimengErrorCode(message) });
    }
    if (parsed.status === 'failed') return { providerTaskId, status: 'failed', videos: [], raw: parsed.parsed, error: jimengErrorMessage(parsed.error, '即梦视频任务失败'), errorCode: jimengErrorCode(parsed.error) };
    if (parsed.status === 'done') return { providerTaskId, status: 'done', videos: [], raw: parsed.parsed, error: '即梦任务已完成，但 CLI 没有下载到视频结果。', errorCode: 'VIDEO_RESULT_MISSING' };
    return { providerTaskId, status: parsed.status, videos: parsed.videos, raw: parsed.parsed };
  } finally {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function idempotencyKey() { return randomUUID(); }

export async function inspectJimengCli(provider: RuntimeProvider) {
  const command = cliCommand(provider);
  return new Promise<{ installed: boolean; version: string; loginHint: string }>((resolve) => {
    const child = spawn(command, ['--version'], { windowsHide: true, shell: jimengCliShell(command) });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', () => resolve({ installed: false, version: '', loginHint: '未检测到即梦 CLI，请按官方安装命令安装后重试' }));
    child.on('close', (code) => resolve({ installed: code === 0, version: output.trim().split(/\r?\n/)[0] || '', loginHint: '请先在即梦网页端完成一次视频生成授权' }));
  });
}

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedVideo, VideoGenerationInput } from './types';
import type { RuntimeProvider } from './providers';

export type VideoProviderTask = {
  providerTaskId?: string;
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

function is65535Provider(provider: RuntimeProvider) {
  return provider.platform === '65535' || /65535\.space/i.test(provider.baseUrl || '') || /65535\.space/i.test(provider.videoBaseUrl || '');
}

function videoBaseUrl(provider: RuntimeProvider) {
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
  const values = [data?.submit_id, data?.submitId, data?.task_id, data?.taskId, data?.request_id, data?.requestId, data?.id, data?.data?.submit_id, data?.data?.submitId, data?.data?.task_id, data?.data?.taskId, data?.data?.id, data?.task?.id, data?.data?.task?.id];
  return String(values.find((value) => value !== undefined && value !== null && String(value).trim()) || '').trim();
}

function statusFrom(data: any): VideoProviderTask['status'] {
  const value = String(data?.status || data?.state || data?.data?.status || data?.data?.state || data?.task?.status || data?.data?.task?.status || '').toLowerCase();
  if (/(done|success|succeed|completed|complete|finished|ready)/.test(value)) return 'done';
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

/**
 * Rate limits are safe to retry here because every submission carries the
 * same idempotency key. This prevents a transient 429 from turning into a
 * failed task while still avoiding duplicate provider charges.
 */
async function requestJsonWithRateLimitRetry(url: string, init: RequestInit, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJson(url, init, signal);
    } catch (error) {
      const providerError = error instanceof VideoProviderError ? error : null;
      if (!providerError || providerError.status !== 429 || attempt >= 3) throw error;
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

function inputPayload(input: VideoGenerationInput) {
  const referenceVideos = videoReferenceValues(input);
  const audios = audioValues(input);
  return {
    prompt: input.prompt,
    seconds: input.seconds,
    aspect_ratio: input.aspectRatio === 'auto' ? undefined : input.aspectRatio,
    resolution: input.resolution,
    input_mode: input.firstFrame && input.lastFrame ? 'frames' : input.firstFrame ? 'first_frame' : input.referenceImages?.length ? 'reference' : undefined,
    input_reference: input.firstFrame ? { image_url: input.firstFrame } : undefined,
    last_frame_url: input.lastFrame,
    reference_image_urls: input.referenceImages || [],
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

export async function submitRemoteVideo(provider: RuntimeProvider, rawModelId: string, input: VideoGenerationInput, idempotencyKey: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const transport = resolveVideoTransport(provider);
  const url = transport === 'native-task' ? endpoint(provider, provider.videoTaskPath, '/v1/tasks') : endpoint(provider, provider.videoGenerationPath, '/v1/videos');
  const body = transport === 'native-task'
    ? { kind: 'video', model: rawModelId, operation: input.operation || 'generate', input: inputPayload(input) }
    : openAiPayload(rawModelId, input);
  const response = await requestJsonWithRateLimitRetry(url, { method: 'POST', headers: headers(provider, idempotencyKey), body: JSON.stringify(body) }, signal);
  const data = response.data;
  const videos = videosFrom(data);
  const providerTaskId = taskIdFrom(data);
  const status = videos.length ? 'done' : statusFrom(data);
  if (status === 'failed') return { providerTaskId, status, videos, error: errorFrom(data, '视频任务失败'), raw: data };
  if (!videos.length && !providerTaskId) throw new VideoProviderError('视频接口已响应，但没有返回视频地址或任务编号');
  return { providerTaskId: providerTaskId || undefined, status: videos.length ? 'done' : status, videos, costUsd: Number(data?.cost_usd || data?.costUsd || data?.data?.cost_usd || 0) || undefined, raw: data };
}

export async function pollRemoteVideo(provider: RuntimeProvider, providerTaskId: string, signal?: AbortSignal): Promise<VideoProviderTask> {
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
  if (/seedance[-_. ]?2\.5/.test(value)) return 'seedance2.5';
  if (/seedance[-_. ]?2\.0.*mini|seedance[-_. ]?2\.0mini/.test(value)) return 'seedance2.0mini';
  if (/seedance[-_. ]?2\.0.*vip|seedance[-_. ]?2\.0vip/.test(value)) return 'seedance2.0_vip';
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
  add('--model_version', jimengModelVersion(rawModelId));

  switch (command) {
    case 'text2video':
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--ratio', input.aspectRatio);
      add('--video_resolution', input.resolution);
      break;
    case 'image2video':
      add('--image', input.firstFrame || input.referenceImages?.[0]);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--video_resolution', input.resolution);
      break;
    case 'frames2video':
      add('--first', input.firstFrame);
      add('--last', input.lastFrame);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--video_resolution', input.resolution);
      break;
    case 'multiframe2video':
      for (const image of input.referenceImages || []) add('--images', image);
      add('--prompt', input.prompt);
      add('--duration', input.seconds);
      add('--ratio', input.aspectRatio);
      add('--video_resolution', input.resolution);
      break;
    case 'multimodal2video':
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

function parseCliOutput(stdout: string) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const videos = videosFrom(parsed);
      if (videos.length || taskIdFrom(parsed)) return { parsed, videos, taskId: taskIdFrom(parsed) };
    } catch {}
  }
  const url = stdout.match(/https?:\/\/[^\s"']+\.(?:mp4|webm|mov)(?:\?[^\s"']*)?/i)?.[0];
  return { parsed: { raw: stdout }, videos: url ? [{ url }] : [], taskId: '' };
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
    const args = cliArgs(cliInput, rawModelId);
    const output = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: jimengCliShell(command) });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const abort = () => { child.kill(); reject(new VideoProviderError('即梦 CLI 任务已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => { signal?.removeEventListener('abort', abort); reject(new VideoProviderError(`无法启动即梦 CLI：${error.message}`)); });
    child.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code: code ?? 1, stdout, stderr }); });
    });
    if (output.code !== 0) throw new VideoProviderError(output.stderr.trim() || '即梦 CLI 生成失败');
    const parsed = parseCliOutput(output.stdout);
    if (!parsed.videos.length && !parsed.taskId) throw new VideoProviderError('即梦 CLI 已完成，但没有解析到视频地址；请检查 CLI 输出格式');
    return { providerTaskId: parsed.taskId || undefined, status: parsed.videos.length ? 'done' : 'pending', videos: parsed.videos, raw: parsed.parsed };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function pollJimengVideo(provider: RuntimeProvider, providerTaskId: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const command = cliCommand(provider);
  const output = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, ['query_result', `--submit_id=${providerTaskId}`], { windowsHide: true, shell: jimengCliShell(command) });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const abort = () => { child.kill(); reject(new VideoProviderError('即梦 CLI 查询已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => { signal?.removeEventListener('abort', abort); reject(new VideoProviderError(`无法启动即梦 CLI：${error.message}`)); });
    child.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code: code ?? 1, stdout, stderr }); });
  });
  if (output.code !== 0) throw new VideoProviderError(output.stderr.trim() || '即梦 CLI 查询失败');
  const parsed = parseCliOutput(output.stdout);
  const status = parsed.videos.length ? 'done' : statusFrom(parsed.parsed);
  return { providerTaskId, status, videos: parsed.videos, raw: parsed.parsed, ...(status === 'failed' ? { error: errorFrom(parsed.parsed, '即梦视频任务失败') } : {}) };
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

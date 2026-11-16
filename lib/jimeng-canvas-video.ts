import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratedVideo, VideoGenerationInput } from './types';
import type { RuntimeProvider } from './providers';
import type { VideoProviderTask } from './video-providers';
import { VideoProviderError } from './video-providers';
import { discoverJimengCanvasModels, runJimengCli } from './jimeng-cli';

type JsonObject = Record<string, unknown>;
type CanvasResult = { values: unknown[]; latest: unknown; output: string };

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJsonValues(output: string): CanvasResult {
  const values: unknown[] = [];
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(parsed))) values.push(parsed);
    } catch {}
  }
  const trimmed = output.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
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
  return { values, latest: values[values.length - 1] || {}, output };
}

function errorFrom(result: CanvasResult, fallback: string) {
  for (const value of result.values.slice().reverse()) {
    const error = objectValue(value).error;
    if (error) {
      const errorObject = objectValue(error);
      const message = typeof error === 'string' ? error : errorObject.message || errorObject.detail || errorObject.code;
      if (message) return String(message);
    }
  }
  return result.output.trim().slice(-1200) || fallback;
}

function findValues(value: unknown, key: RegExp, output: unknown[] = [], depth = 0): unknown[] {
  if (depth > 12 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => findValues(item, key, output, depth + 1));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.test(name)) output.push(child);
    findValues(child, key, output, depth + 1);
  }
  return output;
}

function firstString(result: CanvasResult, key: RegExp) {
  return findValues(result.values, key).map((value) => String(value || '').trim()).find(Boolean) || '';
}

function isCanvasCommand(command: string) {
  return /(?:^|[\\/])dreamina-canvas(?:\.exe|\.cmd)?$/i.test(command) || /^dreamina-canvas(?:\.exe|\.cmd)?$/i.test(command);
}

export function isJimengCanvasCommand(command: string) {
  return isCanvasCommand(command);
}

function modelCandidate(rawModelId: string) {
  const value = String(rawModelId || '').trim().toLowerCase();
  if (!value || value === 'auto' || value === 'jimeng-cli-video') return '';
  if (/seedance[-_. ]?2\.0.*fast.*vip|seedance[-_. ]?2\.0fastvip/.test(value)) return 'seedance_2.0_fast_vip';
  if (/seedance[-_. ]?2\.0.*fast|seedance[-_. ]?2\.0fast/.test(value)) return 'seedance_2.0_fast';
  if (/seedance[-_. ]?2\.0.*mini|seedance[-_. ]?2\.0mini/.test(value)) return 'seedance_2.0_mini';
  if (/seedance[-_. ]?2\.0.*vip|seedance[-_. ]?2\.0vip/.test(value)) return 'seedance_2.0_vip';
  if (/seedance[-_. ]?2\.0/.test(value)) return 'seedance_2.0';
  if (/seedance[-_. ]?2\.5/.test(value)) return 'seedance_2.5';
  if (/seedance[-_. ]?1\.5.*pro/.test(value)) return 'seedance_1.5_pro';
  if (/seedance[-_. ]?1\.0.*fast/.test(value)) return 'seedance_1.0_fast';
  return String(rawModelId).trim();
}

async function resolveCanvasModel(command: string, rawModelId: string, mode: string, signal?: AbortSignal) {
  const requested = modelCandidate(rawModelId);
  const listed = await discoverJimengCanvasModels(command, signal).catch(() => []);
  if (requested) {
    const exact = listed.find((item) => item.model === requested || item.aliases?.some((alias) => alias === rawModelId || alias === requested));
    if (exact) return exact.model;
    if (!listed.length) return requested;
    throw new VideoProviderError(`即梦画布当前模型列表中没有“${rawModelId}”，请先刷新模型列表。`, { code: 'JIMENG_MODEL_UNAVAILABLE' });
  }
  const compatible = listed.find((item) => item.modes?.some((itemMode) => itemMode.name === mode || itemMode.scenario === mode));
  const fallback = listed[0];
  if (compatible?.model || fallback?.model) return compatible?.model || fallback.model;
  throw new VideoProviderError('即梦画布没有返回可用的视频模型，请检查登录状态和会员权益。', { code: 'JIMENG_MODEL_LIST_EMPTY' });
}

function mediaExtension(value: string, mediaType: string) {
  const extension = path.extname(value).replace(/^\./, '').toLowerCase();
  if (extension && /^[a-z0-9]{1,8}$/.test(extension)) return extension;
  return mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'png';
}

async function materialize(value: string, directory: string, index: number, mediaType: 'image' | 'video' | 'audio') {
  const input = String(value || '').trim();
  if (!input) throw new VideoProviderError('即梦画布参考素材为空。', { code: 'JIMENG_REFERENCE_INVALID' });
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new VideoProviderError('即梦画布参考素材格式无效。', { code: 'JIMENG_REFERENCE_INVALID' });
    const extension = mediaExtension('', mediaType);
    const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    const file = path.join(directory, `reference-${index + 1}.${extension}`);
    await writeFile(file, bytes, { flag: 'wx' });
    return file;
  }
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok) throw new VideoProviderError(`无法下载即梦画布参考素材（HTTP ${response.status}）。`, { code: 'JIMENG_REFERENCE_DOWNLOAD_FAILED' });
    const extension = mediaExtension(new URL(input).pathname, mediaType);
    const file = path.join(directory, `reference-${index + 1}.${extension}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
    return file;
  }
  if (!existsSync(input)) throw new VideoProviderError(`即梦画布找不到参考素材：${input}`, { code: 'JIMENG_REFERENCE_NOT_FOUND' });
  return input;
}

async function invoke(command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  const result = await runJimengCli(command, ['--format', 'json', '--non-interactive', ...args], timeoutMs, signal);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = parseJsonValues(output);
  if (result.timedOut) throw new VideoProviderError('即梦画布 CLI 操作超时，任务可能仍在运行，请稍后查询原任务。', { code: 'JIMENG_TIMEOUT' });
  if (result.code !== 0 || parsed.values.some((value) => objectValue(value).ok === false)) {
    const message = errorFrom(parsed, '即梦画布 CLI 操作失败');
    const code = /auth|requiredAction.?login|登录/i.test(message) ? 'JIMENG_AUTH_REQUIRED' : undefined;
    throw new VideoProviderError(message, { code });
  }
  return parsed;
}

function modeFor(input: VideoGenerationInput) {
  const hasVideoOrAudio = Boolean(input.referenceVideo || input.referenceVideos?.length || input.audio || input.audios?.length);
  const imageCount = (input.referenceImages?.length || 0) + Number(Boolean(input.firstFrame)) + Number(Boolean(input.lastFrame));
  if (input.firstFrame || input.lastFrame) return 'first_last_frame';
  if (hasVideoOrAudio || imageCount) return 'm2v';
  return 't2v';
}

function encodedTaskId(projectId: string, submitId: string) {
  return `canvas:${projectId}:${submitId}`;
}

function decodeTaskId(value: string) {
  const match = String(value || '').match(/^canvas:([^:]+):(.+)$/);
  return match ? { projectId: match[1], submitId: match[2] } : { projectId: '', submitId: String(value || '') };
}

function videoResourceIds(result: CanvasResult) {
  const ids: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 12 || value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    const record = value as Record<string, unknown>;
    const type = String(record.type || record.mediaType || '').toLowerCase();
    const resourceId = String(record.resourceId || '').trim();
    if (resourceId && (type === 'video' || record.video || /video/i.test(String(record.name || '')))) ids.push(resourceId);
    Object.values(record).forEach((item) => visit(item, depth + 1));
  };
  result.values.forEach((value) => visit(value));
  return Array.from(new Set(ids));
}

async function downloadVideos(command: string, projectId: string, resources: string[], directory: string, signal?: AbortSignal) {
  const videos: GeneratedVideo[] = [];
  for (const [index, resourceId] of Array.from(new Set(resources)).entries()) {
    const outputPath = path.join(directory, `result-${index + 1}.mp4`);
    await invoke(command, ['resource', 'download', resourceId, '--project-id', projectId, '--output', outputPath], 120_000, signal);
    if (existsSync(outputPath)) videos.push({ url: `data:video/mp4;base64,${(await readFile(outputPath)).toString('base64')}`, providerTaskId: resourceId });
  }
  return videos;
}

export function buildJimengCanvasVideoArgs(projectId: string, input: VideoGenerationInput, model: string, refs: string[], submitId?: string) {
  const mode = modeFor(input);
  const args = ['node', 'create', 'video', '--project-id', projectId, '--run', '--wait', '--yes', '--mode', mode, '--prompt', input.prompt];
  if (model) args.push('--model', model);
  if (input.aspectRatio) args.push('--ratio', input.aspectRatio);
  if (input.resolution) args.push('--resolution', input.resolution);
  if (input.seconds) args.push('--duration', String(input.seconds));
  args.push('--count', '1');
  for (const ref of refs) args.push('--ref', `res:${ref}`);
  if (submitId) args.push('--submit-id', submitId);
  return args;
}

export async function runJimengCanvasVideo(provider: RuntimeProvider, rawModelId: string, input: VideoGenerationInput, signal?: AbortSignal): Promise<VideoProviderTask> {
  const command = provider.jimengCliPath || process.env.JIMENG_CLI_PATH || 'dreamina-canvas';
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-canvas-video-'));
  const projectId = randomUUID();
  try {
    await invoke(command, ['canvas', 'create', `SANMAO ${projectId.slice(0, 8)}`, '--project-id', projectId, '--use'], 60_000, signal);
    const references = [
      ...(input.firstFrame ? [{ value: input.firstFrame, type: 'image' as const }] : []),
      ...(input.lastFrame ? [{ value: input.lastFrame, type: 'image' as const }] : []),
      ...(input.referenceImages || []).map((value) => ({ value, type: 'image' as const })),
      ...(input.referenceVideos || (input.referenceVideo ? [input.referenceVideo] : [])).map((value) => ({ value, type: 'video' as const })),
      ...(input.audios || (input.audio ? [input.audio] : [])).map((value) => ({ value, type: 'audio' as const })),
    ];
    const resourceIdsList: string[] = [];
    for (const [index, reference] of references.entries()) {
      const file = await materialize(reference.value, directory, index, reference.type);
      const uploaded = await invoke(command, ['resource', 'upload', '--project-id', projectId, '--file', file, '--type', reference.type], 120_000, signal);
      const resourceId = firstString(uploaded, /^resourceId$/i);
      if (!resourceId) throw new VideoProviderError('即梦画布素材上传成功但没有返回 resourceId。', { code: 'JIMENG_RESOURCE_MISSING' });
      resourceIdsList.push(resourceId);
    }
    const mode = modeFor(input);
    const model = await resolveCanvasModel(command, rawModelId, mode, signal);
    const submitted = await invoke(command, buildJimengCanvasVideoArgs(projectId, input, model, resourceIdsList), 15 * 60_000, signal);
    const submitId = firstString(submitted, /^(submitId|operationRef)$/i) || firstString(submitted, /^submit_id$/i);
    const videos = await downloadVideos(command, projectId, videoResourceIds(submitted).filter((id) => !resourceIdsList.includes(id)), directory, signal);
    if (videos.length) return { providerTaskId: submitId ? encodedTaskId(projectId, submitId) : undefined, status: 'done', videos, raw: submitted.latest };
    if (!submitId) throw new VideoProviderError('即梦画布已返回结果，但没有 submitId 或视频资源。', { code: 'VIDEO_RESULT_MISSING' });
    return { providerTaskId: encodedTaskId(projectId, submitId), status: 'pending', videos: [], raw: submitted.latest };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function pollJimengCanvasVideo(provider: RuntimeProvider, providerTaskId: string, signal?: AbortSignal): Promise<VideoProviderTask> {
  const command = provider.jimengCliPath || process.env.JIMENG_CLI_PATH || 'dreamina-canvas';
  const { projectId, submitId } = decodeTaskId(providerTaskId);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-canvas-video-result-'));
  try {
    const args = ['operation', 'wait', submitId, '--timeout', '0'];
    if (projectId) args.push('--project-id', projectId);
    const result = await invoke(command, args, 120_000, signal);
    const state = String(firstString(result, /^(state|submissionOutcome)$/i)).toLowerCase();
    const videos = projectId ? await downloadVideos(command, projectId, videoResourceIds(result), directory, signal) : [];
    if (videos.length) return { providerTaskId, status: 'done', videos, raw: result.latest };
    if (/fail|error|cancel|reject/.test(state)) return { providerTaskId, status: 'failed', videos: [], raw: result.latest, error: errorFrom(result, '即梦画布视频任务失败') };
    if (/success|succeed|complete|done|finished|terminal/.test(state)) return { providerTaskId, status: 'done', videos: [], raw: result.latest, error: '即梦画布任务已完成，但没有可下载的视频资源。', errorCode: 'VIDEO_RESULT_MISSING' };
    return { providerTaskId, status: 'pending', videos: [], raw: result.latest };
  } catch (error) {
    if (error instanceof VideoProviderError && error.code === 'JIMENG_TIMEOUT') return { providerTaskId, status: 'pending', videos: [], raw: { timedOut: true } };
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}


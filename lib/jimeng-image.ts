import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedImage } from './types';
import type { RuntimeProvider } from './providers';
import { resolveStoredImageReference } from './image-storage';
import { discoverJimengCanvasModels, inspectJimengCli, parseJimengJsonLines, resolveJimengCanvasCliCommand, resolveJimengCliCommand, runJimengCanvasCli, runJimengCli } from './jimeng-cli';

type ImageInput = {
  prompt: string;
  aspectRatio?: string;
  count?: number;
  width?: number;
  height?: number;
  resolution?: string;
};

export const jimengImageModels = [
  {
    id: 'jimeng-cli-image',
    name: '即梦 · CLI 自动选择',
    capabilities: ['generate', 'edit', 'reference', 'upscale'] as const,
  },
  {
    id: 'seedream5.0pro',
    name: 'Seedream 5.0 Pro',
    capabilities: ['generate', 'edit', 'reference'] as const,
  },
  {
    id: 'seedream4.7',
    name: 'Seedream 4.7',
    capabilities: ['generate', 'edit', 'reference'] as const,
  },
];

export function jimengImageModelVersion(rawId?: string) {
  const value = String(rawId || '').trim().toLowerCase();
  if (!value || value === 'jimeng-cli-image' || value === 'auto') return undefined;
  if (/seedream[-_. ]?5\.0[-_. ]?pro/.test(value)) return '5.0Pro';
  if (/seedream[-_. ]?5\.0/.test(value)) return '5.0';
  if (/seedream[-_. ]?4\.7/.test(value)) return '4.7';
  return String(rawId || '').trim() || undefined;
}

function resolutionValue(value?: string) {
  const normalized = String(value || '2K').toLowerCase();
  return normalized === '1k' || normalized === '1.5k' || normalized === '4k' ? normalized : '2k';
}

function validRatio(value?: string) {
  return /^\d+:\d+$/.test(String(value || '')) ? String(value) : '';
}

export function buildJimengImageCliArgs(operation: 'text2image' | 'image2image', input: ImageInput, references: string[], rawModelId?: string) {
  const args: string[] = [operation];
  const modelVersion = jimengImageModelVersion(rawModelId);
  if (modelVersion) args.push('--model_version', modelVersion);
  args.push('--prompt', input.prompt, '--resolution_type', resolutionValue(input.resolution), '--generate_num', String(Math.max(1, Math.min(10, Number(input.count || 1)))));
  if (input.width && input.height) args.push('--width', String(Math.round(input.width)), '--height', String(Math.round(input.height)));
  else if (validRatio(input.aspectRatio)) args.push('--ratio', String(input.aspectRatio));
  for (const reference of references) args.push('--images', reference);
  return args;
}

function mimeExtension(mime: string) {
  return mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
}

function upscaleResolution(size: string) {
  const [width, height] = String(size || '').split('x').map(Number);
  const longEdge = Math.max(width || 0, height || 0);
  if (longEdge > 4096) return '8k';
  if (longEdge > 2048) return '4k';
  return '2k';
}

export function buildJimengImageUpscaleCliArgs(image: string, size: string) {
  return ['image_upscale', '--image', image, '--resolution_type', upscaleResolution(size), '--poll', '30'];
}

async function materialize(reference: string, directory: string, index: number) {
  const resolved = await resolveStoredImageReference(reference);
  let bytes: Buffer;
  let extension = 'png';
  if (resolved.startsWith('data:')) {
    const match = resolved.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error(`第 ${index + 1} 张参考图格式无效`);
    const mime = match[1] || 'image/png';
    extension = mimeExtension(mime);
    bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  } else if (/^https?:\/\//i.test(resolved)) {
    const response = await fetch(resolved, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`无法读取第 ${index + 1} 张参考图（HTTP ${response.status}）`);
    const contentType = response.headers.get('content-type') || 'image/png';
    extension = mimeExtension(contentType);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = await readFile(resolved);
    extension = path.extname(resolved).replace('.', '').toLowerCase() || 'png';
  }
  const file = path.join(directory, `reference-${index + 1}.${extension}`);
  await writeFile(file, bytes, { flag: 'wx' });
  return file;
}

function addImage(value: unknown, key: string, output: GeneratedImage[], seen: Set<string>, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^data:image\//i.test(text) || (/^https?:\/\//i.test(text) && /(image|png|jpg|jpeg|webp|result|output|url|uri|href)/i.test(key))) {
      if (!seen.has(text)) { seen.add(text); output.push({ url: text }); }
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => addImage(item, key, output, seen, depth + 1)); return; }
  if (typeof value !== 'object') return;
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof childValue === 'string' && /^(b64_json|base64|image_base64)$/i.test(childKey)) {
      const data = `data:image/png;base64,${childValue}`;
      if (!seen.has(data)) { seen.add(data); output.push({ url: data }); }
    } else addImage(childValue, childKey, output, seen, depth + 1);
  }
}

function legacyImagesFrom(output: string): { images: GeneratedImage[]; taskId?: string; failed?: string } {
  const parsed = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const images: GeneratedImage[] = [];
  const seen = new Set<string>();
  parsed.forEach((item) => addImage(item, 'result', images, seen));
  const last = parsed.find((item) => item && typeof item === 'object' && (item.submit_id || item.submitId || item.task_id || item.taskId || item.id)) || {};
  const status = String(last.status || last.state || last.gen_status || '').toLowerCase();
  const error = last.error?.message || last.error_message || last.error || last.message;
  return { images, taskId: String(last.submit_id || last.submitId || last.task_id || last.taskId || '').trim() || undefined, failed: /(fail|error|reject|cancel|expired)/.test(status) ? String(error || '即梦图片任务失败') : undefined };
}

function findJimengField(value: unknown, names: RegExp, depth = 0): unknown {
  if (depth > 12 || value === null || value === undefined || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJimengField(item, names, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (names.test(key) && child !== undefined && child !== null && String(child).trim()) return child;
    const found = findJimengField(child, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function jimengTaskId(values: unknown[]) {
  const value = findJimengField(values, /^(submit_id|submitId|task_id|taskId)$/i)
    ?? findJimengField(values, /^(request_id|requestId)$/i);
  return String(value ?? '').trim() || undefined;
}

function jimengError(values: unknown[]) {
  const value = findJimengField(values, /^(error_message|errorMessage|error|message|detail)$/i);
  if (value && typeof value === 'object') {
    const nested = findJimengField(value, /^(message|detail)$/i);
    return String(nested ?? JSON.stringify(value));
  }
  return String(value ?? '').trim();
}

export function imagesFrom(output: string): { images: GeneratedImage[]; taskId?: string; failed?: string; done?: boolean } {
  const parsed = parseJimengJsonLines(output);
  const images: GeneratedImage[] = [];
  const seen = new Set<string>();
  parsed.forEach((item) => addImage(item, 'result', images, seen));
  const status = String(findJimengField(parsed, /^(status|state|gen_status|genStatus)$/i) ?? '').toLowerCase();
  return {
    images,
    taskId: jimengTaskId(parsed),
    done: /(success|succeed|completed|complete|finished|ready)/.test(status) || status === '50',
    failed: /(fail|error|reject|cancel|expired|aborted)/.test(status)
      ? (jimengError(parsed) || 'Jimeng image task failed')
      : undefined,
  };
}

function imageMime(file: string) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
}

async function downloadedImages(directory: string): Promise<GeneratedImage[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
  return Promise.all(files.map(async (file) => ({
    url: `data:${imageMime(file)};base64,${(await readFile(file)).toString('base64')}`,
  })));
}

async function waitForResult(command: string, taskId: string, outputDirectory: string, deadline: number, signal?: AbortSignal) {
  while (Date.now() < deadline) {
    const result = await runJimengCli(command, ['query_result', `--submit_id=${taskId}`, `--download_dir=${outputDirectory}`], 45_000, signal);
    const parsed = imagesFrom(`${result.stdout}\n${result.stderr}`);
    if (parsed.failed) throw new Error(parsed.failed);
    const files = await downloadedImages(outputDirectory);
    if (files.length) return files;
    if (parsed.images.length) return parsed.images;
    if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Jimeng image query failed');
    if (parsed.done || /missing\s+image[_ -]?url|no\s+image[_ -]?url/i.test(`${result.stdout}\n${result.stderr}`)) {
      throw new Error('Jimeng image task completed, but the CLI did not provide a downloadable image');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      const abort = () => { clearTimeout(timer); reject(signal?.reason || new Error('即梦图片任务已取消')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('即梦图片任务等待超时，请稍后重试');
}

type CanvasResult = { values: unknown[]; latest: unknown; output: string };

function canvasRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canvasValues(output: string): CanvasResult {
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

function canvasFind(value: unknown, key: RegExp, output: unknown[] = [], depth = 0): unknown[] {
  if (depth > 14 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => canvasFind(item, key, output, depth + 1));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.test(name)) output.push(child);
    canvasFind(child, key, output, depth + 1);
  }
  return output;
}

function canvasFirst(result: CanvasResult, key: RegExp) {
  return canvasFind(result.values, key)
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';
}

function canvasError(result: CanvasResult, fallback: string) {
  for (const value of result.values.slice().reverse()) {
    const error = canvasRecord(value).error;
    if (error) {
      const record = canvasRecord(error);
      const message = typeof error === 'string' ? error : record.message || record.detail || record.code;
      if (message) return String(message);
    }
  }
  return result.output.trim().slice(-1200) || fallback;
}

async function invokeCanvas(command: string, args: string[], timeoutMs: number, signal?: AbortSignal, options: { allowIncomplete?: boolean; confirm?: boolean } = {}) {
  const globalArgs = ['--format', 'json', '--non-interactive', ...(options.confirm ? ['--yes'] : [])];
  const result = await runJimengCanvasCli(command, [...globalArgs, ...args], timeoutMs, signal);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = canvasValues(output);
  if (result.timedOut) throw new Error('即梦画布图片任务等待超时，请稍后重试。');
  const code = canvasFirst(parsed, /^code$/i);
  const incomplete = options.allowIncomplete && (result.code === 20 || code === '20' || code === '40012');
  if (!incomplete && (result.code !== 0 || parsed.values.some((value) => canvasRecord(value).ok === false))) {
    throw new Error(canvasError(parsed, '即梦画布图片操作失败'));
  }
  return parsed;
}

type CanvasImageResource = {
  id: string;
  state: string;
  mediaType: 'image' | 'video' | 'audio' | 'unknown';
};

function canvasResourceState(record: Record<string, unknown>) {
  return String(record.state || record.status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function canvasResourceMediaType(record: Record<string, unknown>): CanvasImageResource['mediaType'] {
  const explicit = String(
    record.type || record.mediaType || record.media_type || record.kind || record.contentType || record.mimeType || '',
  ).toLowerCase();
  const format = String(record.format || record.extension || '').toLowerCase();
  const text = `${explicit} ${format} ${String(record.name || record.title || '')}`;
  if (/video|mp4|m4v|mov|webm|avi|mkv/.test(text)) return 'video';
  if (/image|png|jpe?g|webp|gif|avif|bmp/.test(text)) return 'image';
  if (/audio|mp3|wav|m4a|aac|flac|ogg/.test(text)) return 'audio';
  if (record.video && typeof record.video === 'object') return 'video';
  if (record.image && typeof record.image === 'object') return 'image';
  if (record.audio && typeof record.audio === 'object') return 'audio';
  return 'unknown';
}

function canvasImageResources(result: CanvasResult): CanvasImageResource[] {
  const resources: CanvasImageResource[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 14 || value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    const resourceId = String(record.resourceId || record.resource_id || '').trim();
    if (resourceId) {
      const candidate: CanvasImageResource = {
        id: resourceId,
        state: canvasResourceState(record),
        mediaType: canvasResourceMediaType(record),
      };
      const existing = resources.find((item) => item.id === candidate.id);
      if (!existing || (existing.mediaType === 'unknown' && candidate.mediaType !== 'unknown')) {
        if (existing) resources.splice(resources.indexOf(existing), 1);
        resources.push(candidate);
      }
    }
    for (const item of Object.values(record)) {
      visit(item, depth + 1);
    }
  };
  result.values.forEach((value) => visit(value));
  return resources;
}

export function canvasImageResourceIds(result: CanvasResult) {
  return Array.from(new Set(canvasImageResources(result)
    .filter((item) => (item.mediaType === 'image' || item.mediaType === 'unknown')
      && /^(success|succeeded|complete|completed|done|finished|ready|terminal)$/.test(item.state))
    .map((item) => item.id)));
}

export function canvasSubmitId(result: CanvasResult) {
  const visit = (value: unknown, depth = 0): string => {
    if (depth > 14 || value === null || value === undefined || typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = visit(item, depth + 1);
        if (nested) return nested;
      }
      return '';
    }
    const record = value as Record<string, unknown>;
    const submission = canvasRecord(record.submission);
    const identity = canvasRecord(submission.identity);
    const nested = String(
      identity.value
      || submission.submitId
      || submission.submit_id
      || submission.operationRef
      || submission.operation_ref
      || '',
    ).trim();
    if (nested) return nested;
    // Resource records also carry a submitId. They identify the resource
    // upload/generation source, not the resumable node operation.
    const isResource = Boolean(record.resourceId || record.resource_id);
    if (!isResource) {
      const direct = String(
        record.submitId
        || record.submit_id
        || record.operationRef
        || record.operation_ref
        || '',
      ).trim();
      if (direct) return direct;
    }
    for (const child of Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return '';
  };
  return visit(result.values);
}

function canvasProjectId(result: CanvasResult, fallback: string) {
  return canvasFirst(result, /^projectId$/i) || canvasFirst(result, /^project_id$/i) || fallback;
}

function normalizeCanvasModelId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveCanvasImageModel(command: string, rawModelId: string, mode: 't2i' | 'i2i', signal?: AbortSignal) {
  const requested = String(rawModelId || '').trim();
  let models: Awaited<ReturnType<typeof discoverJimengCanvasModels>>;
  try {
    models = await discoverJimengCanvasModels(command, 'image', signal);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '即梦画布图片模型列表查询失败，请先刷新模型列表。');
  }
  if (!models.length) throw new Error('即梦画布没有返回可用的图片模型，请检查登录状态和账户权限。');
  if (requested && requested.toLowerCase() !== 'auto' && requested.toLowerCase() !== 'jimeng-cli-image') {
    const normalized = normalizeCanvasModelId(requested);
    const exact = models.find((item) => normalizeCanvasModelId(item.model) === normalized
      || item.aliases.some((alias) => normalizeCanvasModelId(alias) === normalized));
    if (exact) return exact.model;
    throw new Error(`即梦画布当前图片模型列表中没有“${rawModelId}”，请先刷新模型列表。`);
  }
  const compatible = models.find((item) => item.modes.some((itemMode) => itemMode.name === mode || itemMode.scenario === mode));
  return compatible?.model || models[0]?.model || '';
}

function canvasImageTitle(prompt: string) {
  const title = String(prompt || '').trim().replace(/\s+/g, ' ');
  return (title || 'SANMAO 图片生成').slice(0, 512);
}

function canvasAspectRatio(input: ImageInput) {
  if (input.aspectRatio && /^\d+:\d+$/.test(input.aspectRatio)) return input.aspectRatio;
  const width = Math.round(Number(input.width || 0));
  const height = Math.round(Number(input.height || 0));
  if (width <= 0 || height <= 0) return '';
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / a}:${height / a}`;
}

function imageCount(input: ImageInput) {
  const count = Number(input.count || 1);
  if (!Number.isInteger(count) || count <= 0) throw new Error('即梦画布图片数量必须是正整数。');
  return count;
}

function buildCanvasImageArgs(projectId: string, input: ImageInput, model: string, refs: string[], submitId: string) {
  const mode = refs.length ? 'i2i' : 't2i';
  const args = ['node', 'create', 'image', '--project-id', projectId, '--run', '--mode', mode, '--title', canvasImageTitle(input.prompt), '--prompt', input.prompt, '--count', String(imageCount(input))];
  if (model) args.push('--model', model);
  const ratio = canvasAspectRatio(input);
  if (ratio) args.push('--ratio', ratio);
  if (input.resolution && !/^(?:auto|自动)$/i.test(input.resolution)) args.push('--resolution', String(input.resolution).toUpperCase());
  if (submitId) args.push('--submit-id', submitId);
  refs.forEach((resourceId) => args.push('--ref', `res:${resourceId}`));
  return args;
}

export function buildJimengCanvasImageArgs(projectId: string, input: ImageInput, model: string, refs: string[], submitId: string) {
  return buildCanvasImageArgs(projectId, input, model, refs, submitId);
}

function canvasImageMime(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'image/png';
}

async function downloadCanvasImages(command: string, projectId: string, resources: string[], directory: string, signal?: AbortSignal) {
  const images: GeneratedImage[] = [];
  for (const [index, resourceId] of Array.from(new Set(resources)).entries()) {
    const file = path.join(directory, `result-${index + 1}.png`);
    await invokeCanvas(command, ['resource', 'download', resourceId, '--project-id', projectId, '--output', file], 120_000, signal);
    if (existsSync(file)) {
      const bytes = await readFile(file);
      if (bytes.byteLength) images.push({ url: `data:${canvasImageMime(bytes)};base64,${bytes.toString('base64')}` });
    }
  }
  return images;
}

async function runJimengCanvasImage(provider: RuntimeProvider, rawModelId: string, input: ImageInput, references: string[], signal?: AbortSignal, canvasCommand?: string) {
  const command = canvasCommand || resolveJimengCanvasCliCommand(provider.jimengCliPath || process.env.JIMENG_CANVAS_CLI_PATH || process.env.JIMENG_CLI_PATH);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-canvas-image-'));
  const requestedProjectId = randomUUID();
  try {
    const created = await invokeCanvas(command, ['canvas', 'create', `SANMAO ${requestedProjectId.slice(0, 8)}`, '--project-id', requestedProjectId, '--use'], 60_000, signal);
    const projectId = canvasProjectId(created, requestedProjectId);
    const resourceIds: string[] = [];
    for (const [index, reference] of references.entries()) {
      const file = await materialize(reference, directory, index);
      const uploaded = await invokeCanvas(command, ['resource', 'upload', '--project-id', projectId, '--file', file, '--type', 'image', '--import-kind', 'local_upload'], 120_000, signal);
      const resourceId = canvasFirst(uploaded, /^resourceId$/i) || canvasFirst(uploaded, /^resource_id$/i);
      if (!resourceId) throw new Error('即梦画布图片素材上传成功但没有返回 resourceId。');
      resourceIds.push(resourceId);
    }
    const mode = resourceIds.length ? 'i2i' : 't2i';
    const model = await resolveCanvasImageModel(command, rawModelId, mode, signal);
    const submitId = randomUUID();
    const submitted = await invokeCanvas(command, buildCanvasImageArgs(projectId, input, model, resourceIds, submitId), 120_000, signal, { confirm: true });
    const operationId = canvasSubmitId(submitted) || submitId;
    let images = await downloadCanvasImages(command, projectId, canvasImageResourceIds(submitted).filter((id) => !resourceIds.includes(id)), directory, signal);
    if (!images.length) {
      const completed = await invokeCanvas(command, ['operation', 'wait', operationId, '--project-id', projectId, '--timeout', '30m'], 31 * 60_000, signal, { allowIncomplete: true });
      images = await downloadCanvasImages(command, projectId, canvasImageResourceIds(completed).filter((id) => !resourceIds.includes(id)), directory, signal);
      if (!images.length) {
        const state = canvasFirst(completed, /^(state|status|submissionOutcome)$/i).toLowerCase();
        const failed = /fail|error|cancel|reject/.test(state)
          || completed.values.some((value) => /fail|error|cancel|reject/.test(String(canvasRecord(value).state || canvasRecord(value).status || '').toLowerCase()));
        if (failed) throw new Error(canvasError(completed, '即梦画布图片任务失败'));
        if (!/success|succeed|complete|done|finished|terminal/.test(state)) throw new Error('即梦画布图片任务仍在运行，请稍后查询原任务。');
      }
    }
    if (!images.length) throw new Error('即梦画布任务已完成，但没有返回可下载的图片资源。');
    return images.slice(0, imageCount(input));
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runJimengImage(provider: RuntimeProvider, rawModelId: string, input: ImageInput, references: string[] = [], signal?: AbortSignal) {
  const inspected = await inspectJimengCli(provider);
  if (inspected.canvas) return runJimengCanvasImage(provider, rawModelId, input, references, signal, inspected.command);
  const command = inspected.command || resolveJimengCliCommand(provider.jimengCliPath);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-'));
  const outputDirectory = path.join(directory, 'results');
  try {
    await mkdir(outputDirectory, { recursive: true });
    const files = await Promise.all(references.slice(0, 10).map((reference, index) => materialize(reference, directory, index)));
    const operation = files.length ? 'image2image' : 'text2image';
    const result = await runJimengCli(command, [...buildJimengImageCliArgs(operation, input, files, rawModelId), '--poll', '0'], 90_000, signal);
    if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || '即梦图片生成失败');
    const parsed = imagesFrom(`${result.stdout}\n${result.stderr}`);
    if (parsed.failed) throw new Error(parsed.failed);
    if (parsed.images.length) return parsed.images.slice(0, Math.max(1, Math.min(10, Number(input.count || 1))));
    if (parsed.taskId) return (await waitForResult(command, parsed.taskId, outputDirectory, Date.now() + 30 * 60 * 1000, signal)).slice(0, Math.max(1, Math.min(10, Number(input.count || 1))));
    throw new Error('即梦 CLI 已响应，但没有解析到图片结果');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runJimengImageUpscale(provider: RuntimeProvider, input: { reference: string; size: string }, signal?: AbortSignal) {
  const inspected = await inspectJimengCli(provider);
  if (inspected.canvas) {
    throw new Error('即梦画布 CLI 的图片超分需要 Canvas node-id；当前图片接口没有可安全映射的 node-id，请先使用图片生成结果的画布节点。');
  }
  const command = inspected.command || resolveJimengCliCommand(provider.jimengCliPath);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-upscale-'));
  const outputDirectory = path.join(directory, 'results');
  try {
    await mkdir(outputDirectory, { recursive: true });
    const file = await materialize(input.reference, directory, 0);
    const result = await runJimengCli(command, [...buildJimengImageUpscaleCliArgs(file, input.size).filter((value) => value !== '--poll' && value !== '30'), '--poll', '0'], 90_000, signal);
    if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || '即梦图片超清失败');
    const parsed = imagesFrom(`${result.stdout}\n${result.stderr}`);
    if (parsed.failed) throw new Error(parsed.failed);
    if (parsed.images.length) return parsed.images.slice(0, 1);
    if (parsed.taskId) return (await waitForResult(command, parsed.taskId, outputDirectory, Date.now() + 30 * 60 * 1000, signal)).slice(0, 1);
    throw new Error('即梦 CLI 已响应，但没有解析到超清图片结果');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

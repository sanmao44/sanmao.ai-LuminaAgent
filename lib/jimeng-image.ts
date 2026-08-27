import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedImage } from './types';
import type { RuntimeProvider } from './providers';
import { resolveStoredImageReference } from './image-storage';
import { parseJimengJsonLines, resolveJimengCliCommand, runJimengCli } from './jimeng-cli';

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

export function imagesFrom(output: string): { images: GeneratedImage[]; taskId?: string; failed?: string } {
  const parsed = parseJimengJsonLines(output);
  const images: GeneratedImage[] = [];
  const seen = new Set<string>();
  parsed.forEach((item) => addImage(item, 'result', images, seen));
  const status = String(findJimengField(parsed, /^(status|state|gen_status|genStatus)$/i) ?? '').toLowerCase();
  return {
    images,
    taskId: jimengTaskId(parsed),
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
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      const abort = () => { clearTimeout(timer); reject(signal?.reason || new Error('即梦图片任务已取消')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('即梦图片任务等待超时，请稍后重试');
}

export async function runJimengImage(provider: RuntimeProvider, rawModelId: string, input: ImageInput, references: string[] = [], signal?: AbortSignal) {
  const command = resolveJimengCliCommand(provider.jimengCliPath);
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
  const command = resolveJimengCliCommand(provider.jimengCliPath);
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

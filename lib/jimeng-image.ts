import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedImage } from './types';
import type { RuntimeProvider } from './providers';
import { resolveStoredImageReference } from './image-storage';
import { resolveJimengCliCommand, runJimengCli } from './jimeng-cli';

type ImageInput = {
  prompt: string;
  aspectRatio?: string;
  count?: number;
  width?: number;
  height?: number;
  resolution?: string;
};

function resolutionValue(value?: string) {
  const normalized = String(value || '2K').toLowerCase();
  return normalized === '1k' || normalized === '1.5k' || normalized === '4k' ? normalized : '2k';
}

function validRatio(value?: string) {
  return /^\d+:\d+$/.test(String(value || '')) ? String(value) : '';
}

function commandArgs(operation: 'text2image' | 'image2image', input: ImageInput, references: string[]) {
  const args = [operation, '--prompt', input.prompt, '--resolution_type', resolutionValue(input.resolution), '--generate_num', String(Math.max(1, Math.min(10, Number(input.count || 1))))];
  if (input.width && input.height) args.push('--width', String(Math.round(input.width)), '--height', String(Math.round(input.height)));
  else if (validRatio(input.aspectRatio)) args.push('--ratio', String(input.aspectRatio));
  for (const reference of references) args.push('--images', reference);
  return args;
}

function mimeExtension(mime: string) {
  return mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
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

function imagesFrom(output: string): { images: GeneratedImage[]; taskId?: string; failed?: string } {
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

async function waitForResult(command: string, taskId: string, deadline: number, signal?: AbortSignal) {
  while (Date.now() < deadline) {
    const result = await runJimengCli(command, ['query_result', `--submit_id=${taskId}`], 45_000, signal);
    const parsed = imagesFrom(`${result.stdout}\n${result.stderr}`);
    if (parsed.failed) throw new Error(parsed.failed);
    if (parsed.images.length) return parsed.images;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      const abort = () => { clearTimeout(timer); reject(signal?.reason || new Error('即梦图片任务已取消')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('即梦图片任务等待超时，请稍后重试');
}

export async function runJimengImage(provider: RuntimeProvider, input: ImageInput, references: string[] = [], signal?: AbortSignal) {
  const command = resolveJimengCliCommand(provider.jimengCliPath);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-image-'));
  try {
    const files = await Promise.all(references.slice(0, 10).map((reference, index) => materialize(reference, directory, index)));
    const operation = files.length ? 'image2image' : 'text2image';
    const result = await runJimengCli(command, [...commandArgs(operation, input, files), '--poll', '30'], 90_000, signal);
    if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || '即梦图片生成失败');
    const parsed = imagesFrom(`${result.stdout}\n${result.stderr}`);
    if (parsed.failed) throw new Error(parsed.failed);
    if (parsed.images.length) return parsed.images.slice(0, Math.max(1, Math.min(10, Number(input.count || 1))));
    if (parsed.taskId) return waitForResult(command, parsed.taskId, Date.now() + 30 * 60 * 1000, signal);
    throw new Error('即梦 CLI 已响应，但没有解析到图片结果');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

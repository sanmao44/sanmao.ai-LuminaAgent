import type { CanvasRuntimeState } from './types';

export type CanvasAsset = { id: string; kind: 'image' | 'video'; name: string; url: string; mime: string; size: number };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const message = body && typeof body === 'object' && ('error' in body || 'message' in body)
      ? String((body as { error?: unknown; message?: unknown }).error || (body as { message?: unknown }).message)
      : `请求失败：${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function loadCanvasRuntime() {
  return request<CanvasRuntimeState>('/api/state');
}

async function asDataUrl(url: string) {
  if (!url || url.startsWith('data:')) return url;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取画布参考素材，请重新导入。');
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('参考素材读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export async function uploadCanvasAsset(file: File) {
  return request<CanvasAsset>('/api/canvas/assets', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
}

export async function generateCanvasImage(input: { prompt: string; model?: string; count?: number; aspect?: string; resolution?: string; quality?: string; references?: Array<{ url: string; name?: string }> }) {
  const references = await Promise.all((input.references || []).slice(0, 16).map((item) => asDataUrl(item.url)));
  return request<{ images: Array<{ url: string; revisedPrompt?: string }>; model?: { id?: string; name?: string; provider?: string } }>('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt, model: input.model || 'auto', count: Math.max(1, Math.min(8, Number(input.count || 1))),
      aspectRatio: input.aspect || '自动', resolution: input.resolution || '自动', quality: input.quality || '自动',
      references, referenceImages: (input.references || []).slice(0, 16).map((item, index) => ({ name: item.name || `参考图 ${index + 1}`, url: item.url })),
    }),
  });
}

export async function generateCanvasVideo(input: { prompt: string; model?: string; duration?: number; aspect?: string; resolution?: string; references?: Array<{ url: string; name?: string }>; audio?: boolean }) {
  const references = await Promise.all((input.references || []).slice(0, 16).map((item) => asDataUrl(item.url)));
  const result = await request<{ task: { id: string; status: string; progress?: number; videoUrls?: string[]; error?: string; modelId?: string } }>('/api/video/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: input.model || 'auto', input: { prompt: input.prompt, seconds: Number(input.duration || 5), aspectRatio: input.aspect || '16:9', resolution: input.resolution || '720P', referenceImages: references } }),
  });
  return result.task;
}

export async function getCanvasVideoTask(id: string) {
  return request<{ task: { id: string; status: string; progress?: number; videoUrls?: string[]; error?: string; modelId?: string } }>(`/api/video/tasks/${encodeURIComponent(id)}`);
}

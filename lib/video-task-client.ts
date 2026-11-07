import type { VideoTask } from '@/lib/video-task-store';

export type VideoTaskAction = 'cancel' | 'retry';

export type VideoTaskPage = {
  tasks: VideoTask[];
  total: number;
  page: number;
};

type VideoTaskPageQuery = {
  page: number;
  pageSize: number;
  source: string;
  media: string;
  search?: string;
};

async function readJson<T>(response: Response, fallback = '\u89c6\u9891\u4efb\u52a1\u8bf7\u6c42\u5931\u8d25'): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || fallback);
  return data as T;
}

function isVideoTaskSnapshot(value: unknown): value is VideoTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  const input = task.input;
  return typeof task.id === 'string' && task.id.length > 0
    && typeof task.providerId === 'string'
    && typeof task.modelId === 'string' && task.modelId.length > 0
    && ['generate', 'edit', 'extend'].includes(String(task.operation))
    && ['pending', 'running', 'done', 'failed', 'cancelled'].includes(String(task.status))
    && typeof task.idempotencyKey === 'string'
    && typeof task.createdAt === 'string'
    && typeof task.pollCount === 'number' && Number.isFinite(task.pollCount)
    && [task.videoUrls, task.remoteVideoUrls, task.localVideoPaths].every(
      (urls) => Array.isArray(urls) && urls.every((url) => typeof url === 'string'),
    )
    && input !== null && typeof input === 'object'
    && 'prompt' in input && typeof input.prompt === 'string';
}

export async function getVideoTask(id: string, options: { signal?: AbortSignal } = {}): Promise<VideoTask | null> {
  const response = await fetch(`/api/video/tasks/${encodeURIComponent(id)}?refresh=false`, {
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (response.status === 404) return null;
  const data: unknown = await response.json().catch(() => null);
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error.trim() : '';
    throw new Error(message || '读取视频任务失败');
  }
  if (!isVideoTaskSnapshot(body?.task) || body.task.id !== id) {
    throw new Error('视频任务响应无效，请稍后重试');
  }
  return body.task;
}

export async function listVideoTasksPage(query: VideoTaskPageQuery): Promise<VideoTaskPage | null> {
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.round(Number(query.page) || 1))),
    pageSize: String(query.pageSize),
    source: query.source,
    media: query.media,
  });
  if (query.search?.trim()) params.set('search', query.search.trim());
  const response = await fetch(`/api/video/tasks?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return {
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    total: Math.max(0, Number(data.total) || 0),
    page: Math.max(1, Number(data.page) || 1),
  };
}

export async function deleteVideoTask(id: string): Promise<void> {
  const response = await fetch(`/api/video/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await readJson<{ ok?: boolean }>(response, '\u5220\u9664\u89c6\u9891\u4efb\u52a1\u5931\u8d25');
}

export async function patchVideoTask(id: string, action: VideoTaskAction): Promise<VideoTask> {
  const response = await fetch(`/api/video/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await readJson<{ task: VideoTask }>(response, action === 'cancel' ? '\u505c\u6b62\u8ddf\u8e2a\u5931\u8d25' : '\u91cd\u8bd5\u5931\u8d25');
  return data.task;
}

export async function saveVideoTaskLocally(id: string): Promise<VideoTask> {
  const response = await fetch(`/api/video/tasks/${encodeURIComponent(id)}`, { method: 'POST' });
  const data = await readJson<{ task: VideoTask }>(response, '\u518d\u6b21\u4fdd\u5b58\u89c6\u9891\u5931\u8d25');
  return data.task;
}

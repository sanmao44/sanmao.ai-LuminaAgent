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
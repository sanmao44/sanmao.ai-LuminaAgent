import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveStoredFileWithFallback } from './image-storage';
import type { MediaKind, ReferenceImageRecord } from './types';
import type { GenerationSource } from './generation-source';
import { resolveLocalDataDir } from './data-paths';

export type GenerationLog = {
  id: string;
  createdAt: string;
  status: 'pending' | 'success' | 'error';
  mode: 'generate' | 'edit' | 'upscale' | 'agent' | 'llm' | 'video' | 'audio';
  /** Distinguishes model conversations from media-generation tasks. */
  taskKind?: 'media' | 'llm';
  /** Stable cross-media label for future audio and other creative work. */
  mediaKind?: MediaKind;
  source?: GenerationSource;
  prompt: string;
  presetId?: string;
  presetName?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  resolution?: string;
  aspectRatio?: string;
  outputSize?: string;
  count?: number;
  durationMs?: number;
  providerDurationMs?: number;
  storageDurationMs?: number;
  imageCount?: number;
  imageUrls?: string[];
  storagePath?: string;
  storageError?: string;
  error?: string;
  angle?: Record<string, unknown>;
  references?: ReferenceImageRecord[];
  operation?: 'generate' | 'edit' | 'extend';
  videoUrls?: string[];
  videoPath?: string;
  providerTaskId?: string;
  idempotencyKey?: string;
  costUsd?: number;
  errorCode?: string;
  task?: string;
  llmCallCount?: number;
  /** Real provider-reported usage when the upstream response exposes it. */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  responseChars?: number;
  webSearchStatus?: string;
  /** Agent routing timing, kept separate from provider duration for diagnosis. */
  routeLane?: 'answer' | 'search' | 'action';
  routerMs?: number;
  searchMs?: number;
  /** Browser-only execution counters; page content and tool arguments are excluded. */
  browserToolCallCount?: number;
  browserToolSuccessCount?: number;
  browserToolFailureCount?: number;
  browserToolDurationMs?: number;
  browserToolResultChars?: number;
  browserToolContextChars?: number;
  browserSnapshotCount?: number;
  browserSnapshotChars?: number;
  browserSnapshotTruncationCount?: number;
  browserSnapshotDuplicateCount?: number;
  browserSnapshotStateChanges?: number;
  browserSnapshotUnchangedCount?: number;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
  taskId?: string;
};

const dataDir = resolveLocalDataDir();
const logPath = path.join(dataDir, 'generation-logs.jsonl');
/** 图片、视频、音频共用一套回收站，各自一个子目录。 */
const TRASH_KINDS = ['images', 'videos', 'audio'] as const;
type MediaTrashKind = (typeof TRASH_KINDS)[number];
function trashDirFor(kind: MediaTrashKind) { return path.join(dataDir, 'trash', kind); }
const LOG_ROTATION_BYTES = 10 * 1024 * 1024;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// The API routes allow long-running provider calls, but a task cannot remain
// pending forever when the process or client disappears before the final
// event is written. Reconcile those orphaned records when logs are read.
const STALE_PENDING_MS = 2 * 60 * 60 * 1000;

async function logFiles() {
  try {
    const names = (await readdir(dataDir)).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name)).sort();
    return names.map((name) => path.join(dataDir, name));
  } catch { return [logPath]; }
}

async function rotateLogIfNeeded() {
  try {
    if ((await stat(logPath)).size < LOG_ROTATION_BYTES) return;
    await rename(logPath, path.join(dataDir, `generation-logs-${Date.now()}.jsonl`));
  } catch { /* The next append will recreate the active log if needed. */ }
}

async function readAllGenerationLogs(): Promise<GenerationLog[]> {
  try {
    const merged = new Map<string, GenerationLog>();
    for (const file of await logFiles()) {
      let raw = '';
      try { raw = await readFile(file, 'utf8'); } catch { continue; }
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line) as Partial<GenerationLog> & { id: string; createdAt?: string };
          const previous = merged.get(event.id);
          merged.set(event.id, { ...previous, ...event, createdAt: previous?.createdAt || event.createdAt || new Date().toISOString() } as GenerationLog);
        } catch { /* Ignore a damaged line and keep the remaining log usable. */ }
      }
    }
    return [...merged.values()];
  } catch {
    return [];
  }
}

export async function appendGenerationLog(log: Omit<GenerationLog, 'id' | 'createdAt'>) {
  await mkdir(dataDir, { recursive: true });
  await rotateLogIfNeeded();
  await appendFile(logPath, `${JSON.stringify({ ...log, id: randomUUID(), createdAt: new Date().toISOString() })}\n`, 'utf8');
}

export async function startGenerationLog(log: Omit<GenerationLog, 'id' | 'createdAt' | 'status'>, requestedId?: string) {
  const id = requestedId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestedId) ? requestedId : randomUUID();
  await mkdir(dataDir, { recursive: true });
  await rotateLogIfNeeded();
  await appendFile(logPath, `${JSON.stringify({ ...log, id, createdAt: new Date().toISOString(), status: 'pending' })}\n`, 'utf8');
  return id;
}

export async function finishGenerationLog(id: string, patch: Partial<Omit<GenerationLog, 'id' | 'createdAt'>>) {
  await mkdir(dataDir, { recursive: true });
  await rotateLogIfNeeded();
  await appendFile(logPath, `${JSON.stringify({ ...patch, id })}\n`, 'utf8');
}

export async function listGenerationLogs(limit = 200): Promise<GenerationLog[]> {
  const logs = (await readAllGenerationLogs()).map(normalizeCompletedMediaLog);
  const now = Date.now();
  const staleLogs = logs.filter((log) => log.status === 'pending' && now - new Date(log.createdAt).getTime() > STALE_PENDING_MS);
  if (staleLogs.length) {
    const error = '任务超时或服务中断，未收到服务商完成回执';
    await Promise.all(staleLogs.map((log) => finishGenerationLog(log.id, {
      status: 'error',
      durationMs: Math.max(0, now - new Date(log.createdAt).getTime()),
      error,
    }).catch(() => undefined)));
    const staleIds = new Set(staleLogs.map((log) => log.id));
    return logs.map((log): GenerationLog => staleIds.has(log.id) ? {
      ...log,
      status: 'error',
      durationMs: Math.max(0, now - new Date(log.createdAt).getTime()),
      error,
    } : log).reverse().slice(0, limit);
  }
  return logs.reverse().slice(0, limit);
}

function normalizeCompletedMediaLog(log: GenerationLog): GenerationLog {
  const hasOutput = Boolean(
    log.imageUrls?.some((url) => Boolean(String(url || '').trim()))
      || log.videoUrls?.some((url) => Boolean(String(url || '').trim())),
  );
  if (hasOutput && log.mode !== 'llm' && log.taskKind !== 'llm' && log.status !== 'success') {
    return { ...log, status: 'success', error: undefined };
  }
  return log;
}

/** Find the current record for a client task or provider task. */
export async function findGenerationLog(taskId: string): Promise<GenerationLog | undefined> {
  const normalized = String(taskId || '').trim();
  if (!normalized) return undefined;
  const logs = await listGenerationLogs(5000);
  const matches = logs.filter((log) => log.id === normalized || log.taskId === normalized || log.providerTaskId === normalized);
  // An Agent run writes one LLM log and one media log with the same taskId.
  // If the stream is interrupted after the provider accepted the image, the
  // LLM log may become `error` before the media log is finalized. Returning
  // that unrelated error makes the canvas mark a task failed even though the
  // provider result is about to arrive. Prefer the media lifecycle, then
  // terminal results, and only fall back to the LLM record when no media log
  // exists.
  const mediaMatches = matches.filter((log) => log.mode !== 'llm' && log.taskKind !== 'llm');
  const candidates = mediaMatches.length ? mediaMatches : matches;
  return candidates.find((log) => log.status === 'success' && (log.imageUrls?.length || log.videoUrls?.length))
    || candidates.find((log) => log.status === 'pending')
    || candidates.find((log) => log.status === 'error')
    || matches[0];
}

function storedFileFromUrl(url: string, storagePath?: string) {
  try {
    const parsed = new URL(url, 'http://sanmao.local');
    if (parsed.pathname !== '/api/storage/file') return null;
    const name = parsed.searchParams.get('name') || '';
    return name ? resolveStoredFileWithFallback(storagePath || '', name) : null;
  } catch {
    return null;
  }
}

export async function purgeExpiredMediaTrash() {
  for (const kind of TRASH_KINDS) {
    const dir = trashDirFor(kind);
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        if (Date.now() - (await stat(file)).mtimeMs > TRASH_RETENTION_MS) await rm(file, { force: true });
      }
    } catch { /* 该类别还没有回收站目录时跳过。 */ }
  }
}

/** 删除素材时先进回收站（默认保留 7 天）；视频/音频此前是直接删除，删了找不回。 */
export async function moveMediaToTrash(file: string, kind: MediaTrashKind = 'images') {
  const dir = trashDirFor(kind);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${Date.now()}-${randomUUID()}-${path.basename(file)}`);
  try { await rename(file, target); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
    await copyFile(file, target);
    await rm(file, { force: true });
  }
}

export async function cleanupGenerationLogs(options: { before?: Date; deleteImages?: boolean; dryRun?: boolean } = {}) {
  const allLogs = await readAllGenerationLogs();
  const cutoff = options.before?.getTime();
  const removedLogs = cutoff === undefined ? allLogs : allLogs.filter((log) => new Date(log.createdAt).getTime() < cutoff);
  const keptLogs = cutoff === undefined ? [] : allLogs.filter((log) => new Date(log.createdAt).getTime() >= cutoff);
  let deletedImages = 0;

  if (options.deleteImages) {
    const files = new Set<string>();
    for (const log of removedLogs) for (const url of log.imageUrls || []) {
      const file = storedFileFromUrl(url, log.storagePath);
      if (file) files.add(file);
    }
    for (const file of files) {
      if (options.dryRun) { deletedImages += 1; continue; }
      try { await moveMediaToTrash(file, 'images'); deletedImages += 1; } catch {}
    }
  }

  if (options.dryRun) return { removedLogs: removedLogs.length, deletedImages, dryRun: true };

  await mkdir(dataDir, { recursive: true });
  for (const file of await logFiles()) if (file !== logPath) await rm(file, { force: true });
  await writeFile(logPath, keptLogs.length ? `${keptLogs.map((log) => JSON.stringify(log)).join('\n')}\n` : '', 'utf8');
  await purgeExpiredMediaTrash();
  return { removedLogs: removedLogs.length, deletedImages, dryRun: false };
}

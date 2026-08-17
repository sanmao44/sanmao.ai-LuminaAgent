import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveStoredFileWithFallback } from './image-storage';

export type GenerationLog = {
  id: string;
  createdAt: string;
  status: 'pending' | 'success' | 'error';
  mode: 'generate' | 'edit' | 'upscale' | 'agent';
  source?: 'workspace' | 'agent';
  prompt: string;
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
};

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const logPath = path.join(dataDir, 'generation-logs.jsonl');
const LOG_ROTATION_BYTES = 10 * 1024 * 1024;

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
  return (await readAllGenerationLogs()).reverse().slice(0, limit);
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

export async function cleanupGenerationLogs(options: { before?: Date; deleteImages?: boolean } = {}) {
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
      try { await rm(file, { force: true }); deletedImages += 1; } catch {}
    }
  }

  await mkdir(dataDir, { recursive: true });
  for (const file of await logFiles()) if (file !== logPath) await rm(file, { force: true });
  await writeFile(logPath, keptLogs.length ? `${keptLogs.map((log) => JSON.stringify(log)).join('\n')}\n` : '', 'utf8');
  return { removedLogs: removedLogs.length, deletedImages };
}

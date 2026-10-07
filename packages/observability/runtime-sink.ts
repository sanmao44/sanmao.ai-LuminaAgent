import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeEvent, RuntimeObserver, RuntimeOperationKind } from '../contracts/observability';
import { BufferedRuntimeObserver } from '../contracts/observability';

/**
 * Operational telemetry is deliberately a small JSONL sink.  It is a
 * persistence adapter for the RuntimeObserver contract, rather than a
 * dependency of Agent, Tool, Provider or Task domain code.
 *
 * Only the fields in RuntimeEvent are accepted and values are bounded before
 * they reach disk.  Prompts, tool arguments, response bodies and secrets are
 * never part of this sink's representation.
 */
export const RUNTIME_EVENT_RETENTION_DAYS = 7;
export const RUNTIME_EVENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const RUNTIME_EVENT_RECENT_LIMIT = 100;

export type RuntimeEventSinkOptions = {
  directory: string;
  maxFileBytes?: number;
  retentionDays?: number;
  now?: () => number;
};

const OPERATION_KINDS: readonly RuntimeOperationKind[] = ['agent', 'tool', 'mcp', 'provider', 'task', 'database', 'backup'];
const PHASES = ['started', 'completed', 'failed'] as const;

function boundedToken(value: unknown, maxLength = 160) {
  return String(value ?? '')
    .replace(/\s+/g, '_')
    .replace(/bearer\s+[\w.\-]{8,}/gi, 'bearer_***')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[:=]\s*)[^\s,;"']{6,}/gi, '$1***')
    .replace(/\b(?:sk|gh[pousr])_[A-Za-z0-9_-]{12,}\b/gi, '***')
    .replace(/[^\w.:-]/g, '_')
    .slice(0, maxLength);
}

function finiteInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

/** Redact and normalize an event before it crosses the operational boundary. */
export function sanitizeRuntimeEvent(event: RuntimeEvent, now = Date.now()): RuntimeEvent {
  const kind = OPERATION_KINDS.includes(event.kind) ? event.kind : 'agent';
  const phase = PHASES.includes(event.phase) ? event.phase : 'failed';
  const sanitized: RuntimeEvent = {
    operationId: boundedToken(event.operationId),
    kind,
    phase,
    at: finiteInteger(event.at, now),
  };
  if (event.durationMs !== undefined) sanitized.durationMs = finiteInteger(event.durationMs, 0);
  if (event.status !== undefined) sanitized.status = boundedToken(event.status, 80);
  if (event.identity !== undefined) sanitized.identity = boundedToken(event.identity, 120);
  if (event.errorClass !== undefined) sanitized.errorClass = boundedToken(event.errorClass, 80);
  if (event.retry !== undefined) sanitized.retry = finiteInteger(event.retry, 0);
  return sanitized;
}

function dayStamp(at: number) {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function eventFile(directory: string, stamp: string, part: number) {
  return path.join(directory, part === 1 ? `runtime-events-${stamp}.jsonl` : `runtime-events-${stamp}.${part}.jsonl`);
}

async function pickFile(directory: string, stamp: string, incomingBytes: number, maxFileBytes: number) {
  for (let part = 1; part <= 9; part += 1) {
    const file = eventFile(directory, stamp, part);
    let size = 0;
    try { size = (await stat(file)).size; } catch { /* file does not exist yet */ }
    if (size + incomingBytes <= maxFileBytes) return file;
  }
  return null;
}

async function prune(directory: string, now: number, retentionDays: number) {
  const cutoff = dayStamp(now - Math.max(1, retentionDays) * 24 * 60 * 60_000);
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  await Promise.all(names.map(async (name) => {
    const stamp = name.match(/^runtime-events-(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!stamp || stamp >= cutoff) return;
    await rm(path.join(directory, name), { force: true }).catch(() => undefined);
  }));
}

/** File backed RuntimeObserver for local operational inspection. */
export class FileRuntimeObserver implements RuntimeObserver {
  private pending: Promise<void> = Promise.resolve();
  private readonly maxFileBytes: number;
  private readonly retentionDays: number;
  private readonly now: () => number;

  constructor(private readonly options: RuntimeEventSinkOptions) {
    this.maxFileBytes = Math.max(1024, Math.floor(options.maxFileBytes || RUNTIME_EVENT_MAX_FILE_BYTES));
    this.retentionDays = Math.max(1, Math.floor(options.retentionDays || RUNTIME_EVENT_RETENTION_DAYS));
    this.now = options.now || Date.now;
  }

  emit(event: RuntimeEvent) {
    const safe = sanitizeRuntimeEvent(event, this.now());
    const line = `${JSON.stringify(safe)}\n`;
    this.pending = this.pending.then(async () => {
      const at = this.now();
      await mkdir(this.options.directory, { recursive: true });
      const file = await pickFile(this.options.directory, dayStamp(at), Buffer.byteLength(line), this.maxFileBytes);
      if (!file) return;
      await appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
      await prune(this.options.directory, at, this.retentionDays);
    }).catch(() => undefined);
    return this.pending;
  }
}

/**
 * Keeps the bounded in-process view used by request diagnostics while also
 * sending the same redacted events to the operational sink.  Emit is
 * best-effort for the file side and never changes runtime behavior.
 */
export class OperationalRuntimeObserver implements RuntimeObserver {
  private readonly buffer: BufferedRuntimeObserver;
  private readonly file: FileRuntimeObserver;

  constructor(options: RuntimeEventSinkOptions & { maxEvents?: number }) {
    this.buffer = new BufferedRuntimeObserver(options.maxEvents || 1000);
    this.file = new FileRuntimeObserver(options);
  }

  emit(event: RuntimeEvent) {
    this.buffer.emit(event);
    return this.file.emit(event);
  }

  snapshot() {
    return this.buffer.snapshot();
  }
}

export type RecentRuntimeEventsOptions = RuntimeEventSinkOptions & { limit?: number };

/** Read the newest operational events without loading unbounded history. */
export async function recentRuntimeEvents(options: RecentRuntimeEventsOptions): Promise<RuntimeEvent[]> {
  const wanted = Math.max(1, Math.min(500, Math.floor(options.limit || RUNTIME_EVENT_RECENT_LIMIT)));
  let files: string[];
  try { files = (await readdir(options.directory)).filter((name) => /^runtime-events-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/.test(name)).sort().reverse(); } catch { return []; }
  const events: RuntimeEvent[] = [];
  for (const file of files) {
    let lines: string[];
    try { lines = (await readFile(path.join(options.directory, file), 'utf8')).split('\n'); } catch { continue; }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try { events.push(sanitizeRuntimeEvent(JSON.parse(line) as RuntimeEvent)); } catch { /* ignore a torn line */ }
      if (events.length >= wanted) return events;
    }
  }
  return events;
}

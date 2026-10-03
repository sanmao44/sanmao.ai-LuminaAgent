import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createBackupArchive, extractBackupArchiveStreaming, sha256, type BackupArchiveEntry } from './backup-archive';
import { decryptBackupPayload, encryptBackupPayload } from './backup-crypto';
import { getDefaultStoragePath, getStorageRoots } from './image-storage';
import { getDefaultAudioStoragePath, getAudioStorageRoots } from './audio-storage';
import { getDefaultVideoStoragePath, getVideoStorageRoots } from './video-storage';
import { encryptSecret } from './store';
import { resolveLocalDataDir, resolveProviderConfigDir } from './data-paths';
import { BackupRestoreTransaction } from './backup-restore-transaction';
import { validateWorkspaceShape } from './workspace-format';

const dataDir = resolveLocalDataDir();
const providerConfigDir = resolveProviderConfigDir();
const snapshotDir = path.join(dataDir, 'backups', 'auto');
const statePath = path.join(providerConfigDir, 'state.json');
const workspacePath = path.join(dataDir, 'workspace.json');
const keyPath = path.join(providerConfigDir, 'master.key');
const SNAPSHOT_FORMAT = 'sanmao-ai-auto-snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_METADATA_SUFFIX = '.meta.json';
const KEEP_SNAPSHOTS = 7;
/** 快照失败后的退避时长：心跳每 2 秒触发一次，不能失败一次就重试一次。 */
const SNAPSHOT_RETRY_BACKOFF_MS = 30 * 60 * 1000;
let snapshotRetryAfter = 0;
/**
 * 每份快照都是媒体库的全量副本（本机实测约 2.1GB），只按份数保留会让占用随
 * 素材线性膨胀。除份数外再按总字节收敛，写盘前还要留出安全余量。
 */
const SNAPSHOT_TOTAL_MAX_BYTES = Number(process.env.SANMAO_SNAPSHOT_TOTAL_MAX_BYTES || 8 * 1024 * 1024 * 1024);
const SNAPSHOT_MIN_FREE_BYTES = Number(process.env.SANMAO_SNAPSHOT_MIN_FREE_BYTES || 1536 * 1024 * 1024);
const SNAPSHOT_SIGNATURE_PATH = path.join(snapshotDir, 'content-signature.json');
/** 任务队列与 MCP 配置体积很小，恢复后缺了会丢状态，快照里一并带上。 */
export const SNAPSHOT_DURABLE_FILES = ['video-tasks.json', 'upscale-tasks.json', 'clone-jobs.json'] as const;
/**
 * 快照会先把媒体读进内存再加密，视频动辄数百 MB，必须限流：
 * 视频/音频按类别限额（历史上丢的正是视频），超过预算的部分只记跳过数量；
 * 图片沿用原来的无上限行为，不因新增视频而少备份图片。
 */
const SNAPSHOT_MEDIA_PATTERNS = {
  videos: /\.(mp4|webm|mov|m4v|ogv)$/i,
  audio: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i,
  images: /\.(png|jpe?g|webp)$/i,
} as const;
const MAX_SNAPSHOT_MEDIA_FILE_BYTES = Number(process.env.SANMAO_SNAPSHOT_MEDIA_FILE_MAX_BYTES || 256 * 1024 * 1024);
const SNAPSHOT_MEDIA_BUDGETS = {
  videos: Number(process.env.SANMAO_SNAPSHOT_VIDEO_MAX_BYTES || 512 * 1024 * 1024),
  audio: Number(process.env.SANMAO_SNAPSHOT_AUDIO_MAX_BYTES || 128 * 1024 * 1024),
  images: Number(process.env.SANMAO_SNAPSHOT_IMAGE_MAX_BYTES || Number.POSITIVE_INFINITY),
};

type SnapshotMediaStats = { videos: number; audio: number; images: number; skipped: number };

type SnapshotMediaPlanItem = { name: string; file: string; size: number; kind: keyof SnapshotMediaStats };
type SnapshotMediaPlan = { items: SnapshotMediaPlanItem[]; bytes: number; skipped: number; signature: string[] };

/**
 * 只 stat 不读取：这样能在读进内存前算出体积、生成内容签名，也能在预算不足时
 * 优先保留最新素材（旧实现按目录顺序遍历，超预算会先丢后面的文件）。
 */
async function planSnapshotMedia(settings: { imageStoragePath?: string; videoStoragePath?: string }): Promise<SnapshotMediaPlan> {
  const items: SnapshotMediaPlanItem[] = [];
  const signature: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  let skipped = 0;
  const targets = [
    // Storage modules intentionally search legacy roots when serving old
    // records. A snapshot is different: it must describe this installation,
    // not every historical directory that happens to be discoverable.
    { folder: 'videos' as const, pattern: SNAPSHOT_MEDIA_PATTERNS.videos, roots: [path.resolve(String(settings.videoStoragePath || getDefaultVideoStoragePath()))] },
    { folder: 'audio' as const, pattern: SNAPSHOT_MEDIA_PATTERNS.audio, roots: [path.resolve(getDefaultAudioStoragePath())] },
    { folder: 'images' as const, pattern: SNAPSHOT_MEDIA_PATTERNS.images, roots: [path.resolve(String(settings.imageStoragePath || getDefaultStoragePath()))] },
  ];
  for (const target of targets) {
    let budget = SNAPSHOT_MEDIA_BUDGETS[target.folder];
    const candidates: Array<{ relative: string; file: string; size: number; mtimeMs: number }> = [];
    for (const root of target.roots) {
      for (const file of await listFiles(root)) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (!relative || seen.has(relative) || !target.pattern.test(relative)) continue;
        seen.add(relative);
        const info = await stat(file).catch(() => null);
        if (!info || !info.isFile() || info.size <= 0 || info.size > MAX_SNAPSHOT_MEDIA_FILE_BYTES) { skipped += 1; continue; }
        candidates.push({ relative, file, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.relative.localeCompare(right.relative));
    for (const candidate of candidates) {
      if (candidate.size > budget) { skipped += 1; continue; }
      budget -= candidate.size;
      const name = `${target.folder}/${candidate.relative}`;
      items.push({ name, file: candidate.file, size: candidate.size, kind: target.folder });
      signature.push(`${name}:${candidate.size}:${Math.round(candidate.mtimeMs)}`);
      bytes += candidate.size;
    }
  }
  return { items, bytes, skipped, signature };
}

type LocalSnapshotResult = {
  path: string;
  createdAt: string;
  bytes: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  skippedMediaCount: number;
  reason: string;
  /** 素材与上次快照完全一致时跳过重复打包。 */
  skipped?: boolean;
};
let snapshotInFlight: Promise<LocalSnapshotResult> | null = null;

function jsonBuffer(value: unknown) { return Buffer.from(JSON.stringify(value, null, 2), 'utf8'); }

async function listFiles(root: string): Promise<string[]> {
  try {
    const files: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...await listFiles(target));
      else if (entry.isFile()) files.push(target);
    }
    return files;
  } catch { return []; }
}

async function snapshotPassword() {
  const external = process.env.SANMAO_MASTER_KEY?.trim();
  if (external) return external;
  try {
    const raw = (await readFile(keyPath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/i.test(raw)) return raw;
  } catch {}
  await encryptSecret('SANMAO snapshot key initialization');
  return (await readFile(keyPath, 'utf8')).trim();
}

function snapshotName() { return `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.sanmao-snapshot`; }

async function createLocalSnapshotInternal(reason: string) {
  await mkdir(snapshotDir, { recursive: true });
  const state = await readFile(statePath).catch(() => jsonBuffer({ schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } }));
  const workspace = await readFile(workspacePath).catch(() => Buffer.alloc(0));
  const durable = new Map<string, Buffer>();
  for (const name of SNAPSHOT_DURABLE_FILES) {
    const data = await readFile(path.join(dataDir, name)).catch(() => Buffer.alloc(0));
    if (data.length) durable.set(name, data);
  }
  const mcpConfig = await readFile(path.join(dataDir, 'mcp', 'servers.json')).catch(() => Buffer.alloc(0));
  const logFiles = (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value));
  const logBytes = new Map<string, number>();
  for (const name of logFiles) {
    const info = await stat(path.join(dataDir, name)).catch(() => null);
    if (info) logBytes.set(name, info.size);
  }
  const stateObject = JSON.parse(state.toString('utf8')) as { settings?: { imageStoragePath?: string; videoStoragePath?: string } };
  const mediaPlan = await planSnapshotMedia(stateObject.settings || {});

  const signature = createHash('sha256')
    .update(sha256(state))
    .update(sha256(workspace))
    .update(sha256(mcpConfig))
    .update([...durable].map(([name, data]) => `${name}:${sha256(data)}`).join('|'))
    .update([...logBytes].map(([name, size]) => `${name}:${size}`).join('|'))
    .update(mediaPlan.signature.join('|'))
    .digest('hex');

  // 素材没变时再打包一份完全相同的副本，只会多占约 2GB 磁盘和一遍 CPU。
  if (reason === 'scheduled') {
    const previous = await readSnapshotSignature();
    if (previous && previous.signature === signature) {
      const existing = (await listLocalSnapshots()).find((item) => item.name === previous.snapshot);
      if (existing) return { ...existing, ...mediaPlanCounts(mediaPlan), skippedMediaCount: mediaPlan.skipped, reason, skipped: true };
    }
  }

  const plannedBytes = state.byteLength + workspace.byteLength + mcpConfig.byteLength
    + [...durable.values()].reduce((sum, data) => sum + data.byteLength, 0)
    + [...logBytes.values()].reduce((sum, size) => sum + size, 0)
    + mediaPlan.bytes;
  if (!await reserveSnapshotSpace(plannedBytes)) {
    throw new Error(`磁盘剩余空间不足，已跳过本次快照（约需 ${(plannedBytes / (1024 * 1024)).toFixed(0)}MB）`);
  }

  const entries: BackupArchiveEntry[] = [{ name: 'server/state.json', data: state }];
  // Keep one canonical archive location, matching full backups. The automatic
  // snapshot reads the existing durable sync mirror as its source.
  if (workspace.length) entries.push({ name: 'client/client.json', data: workspace });
  if (mcpConfig.length) entries.push({ name: 'server/mcp/servers.json', data: mcpConfig });
  for (const [name, data] of durable) entries.push({ name: `server/tasks/${name}`, data });
  for (const name of logFiles) {
    const data = await readFile(path.join(dataDir, name)).catch(() => null);
    if (data) entries.push({ name: `server/logs/${name}`, data });
  }
  const key = await readFile(keyPath).catch(() => Buffer.alloc(0));
  if (key.length) entries.push({ name: 'server/master.key', data: key });

  const media: SnapshotMediaStats = { videos: 0, audio: 0, images: 0, skipped: mediaPlan.skipped };
  for (const item of mediaPlan.items) {
    try {
      entries.push({ name: item.name, data: await readFile(item.file) });
      media[item.kind] += 1;
    } catch {
      media.skipped += 1;
    }
  }

  const manifest = {
    format: SNAPSHOT_FORMAT,
    version: 1,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    canonical: { workspace: 'client/client.json' },
    reason,
    createdAt: new Date().toISOString(),
    signature,
    media,
    files: entries.map((entry) => ({ name: entry.name, bytes: entry.data.byteLength, sha256: sha256(entry.data) })),
  };
  const archive = await createBackupArchive([{ name: 'manifest.json', data: jsonBuffer(manifest) }, ...entries]);
  const encrypted = encryptBackupPayload(archive, await snapshotPassword());
  const file = path.join(snapshotDir, snapshotName());
  await writeFile(file, encrypted, { flag: 'wx', flush: true });
  try {
    await writeFile(`${file}${SNAPSHOT_METADATA_SUFFIX}`, `${JSON.stringify({ skippedMediaCount: media.skipped, imageCount: media.images, videoCount: media.videos, audioCount: media.audio, updatedAt: manifest.createdAt }, null, 2)}\n`, 'utf8');
  } catch (error) {
    await rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
  await pruneLocalSnapshots();
  await writeSnapshotSignature(signature, path.basename(file));
  return {
    path: file,
    createdAt: manifest.createdAt,
    bytes: encrypted.byteLength,
    imageCount: media.images,
    videoCount: media.videos,
    audioCount: media.audio,
    skippedMediaCount: media.skipped,
    reason,
    skipped: false,
  };
}

function mediaPlanCounts(plan: SnapshotMediaPlan) {
  return {
    imageCount: plan.items.filter((item) => item.kind === 'images').length,
    videoCount: plan.items.filter((item) => item.kind === 'videos').length,
    audioCount: plan.items.filter((item) => item.kind === 'audio').length,
  };
}

async function snapshotFreeBytes() {
  try {
    const info = await statfs(snapshotDir);
    return Number(info.bavail) * Number(info.bsize);
  } catch { return null; }
}

/** 空间不足时先淘汰旧快照（永远保留最新一份），仍然不够才放弃本次写入。 */
async function reserveSnapshotSpace(requiredBytes: number) {
  const needed = requiredBytes + SNAPSHOT_MIN_FREE_BYTES;
  let available = await snapshotFreeBytes();
  if (available === null || available >= needed) return true;
  for (const old of (await listLocalSnapshots()).slice(1)) {
    await rm(old.path, { force: true }).catch(() => undefined);
    await rm(`${old.path}${SNAPSHOT_METADATA_SUFFIX}`, { force: true }).catch(() => undefined);
    available += old.bytes;
    if (available >= needed) return true;
  }
  return available >= needed;
}

/** 份数与总字节双重收敛；最新一份永远保留，避免磁盘把最新状态也清掉。 */
async function pruneLocalSnapshots() {
  let kept = 0;
  let keptBytes = 0;
  for (const snapshot of await listLocalSnapshots()) {
    if (kept > 0 && (kept >= KEEP_SNAPSHOTS || keptBytes + snapshot.bytes > SNAPSHOT_TOTAL_MAX_BYTES)) {
      await rm(snapshot.path, { force: true }).catch(() => undefined);
      await rm(`${snapshot.path}${SNAPSHOT_METADATA_SUFFIX}`, { force: true }).catch(() => undefined);
      continue;
    }
    kept += 1;
    keptBytes += snapshot.bytes;
  }
}

async function readSnapshotSignature() {
  try {
    const value = JSON.parse(await readFile(SNAPSHOT_SIGNATURE_PATH, 'utf8')) as { signature?: unknown; snapshot?: unknown };
    if (typeof value.signature === 'string' && value.signature && typeof value.snapshot === 'string' && value.snapshot) {
      return { signature: value.signature, snapshot: value.snapshot };
    }
  } catch {}
  return null;
}

async function writeSnapshotSignature(signature: string, snapshot: string) {
  await writeFile(SNAPSHOT_SIGNATURE_PATH, `${JSON.stringify({ signature, snapshot, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8').catch(() => undefined);
}

export async function createLocalSnapshot(reason = 'scheduled') {
  if (snapshotInFlight) return snapshotInFlight;
  const operation = createLocalSnapshotInternal(reason);
  snapshotInFlight = operation.finally(() => { snapshotInFlight = null; });
  return snapshotInFlight;
}

export async function ensureLocalSnapshot() {
  const snapshots = await listLocalSnapshots();
  const latest = snapshots[0];
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < 24 * 60 * 60 * 1000) return latest;
  if (Date.now() < snapshotRetryAfter) return latest ?? null;
  try {
    const created = await createLocalSnapshot('scheduled');
    snapshotRetryAfter = 0;
    return created;
  } catch (error) {
    // 心跳每 2 秒就会走到这里。失败后必须退避，否则每个心跳都要重新打包几 GB
    // 素材，把 CPU、内存和事件循环全部吃满，静态资源（服务商 logo 等）随之超时，
    // 界面看起来就是"所有 logo 都不见了"。同时不要把异常抛回心跳，避免前端
    // 认为会话失效而停止上报。
    snapshotRetryAfter = Date.now() + SNAPSHOT_RETRY_BACKOFF_MS;
    console.error('[Snapshot] 自动快照失败，将稍后重试：', error);
    return latest ?? null;
  }
}

export async function listLocalSnapshots() {
  const result: Array<{ name: string; path: string; createdAt: string; bytes: number; skippedMediaCount?: number; imageCount?: number; videoCount?: number; audioCount?: number }> = [];
  for (const name of await readdir(snapshotDir).catch(() => [])) {
    if (!/^snapshot-.*\.sanmao-snapshot$/.test(name)) continue;
    const file = path.join(snapshotDir, name);
    try {
      const info = await stat(file);
      let metadata: { skippedMediaCount?: number; imageCount?: number; videoCount?: number; audioCount?: number } = {};
      try { metadata = JSON.parse(await readFile(`${file}${SNAPSHOT_METADATA_SUFFIX}`, 'utf8')) as typeof metadata; } catch {}
      result.push({ name, path: file, createdAt: new Date(info.mtimeMs).toISOString(), bytes: info.size, ...metadata });
    } catch {}
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function validateEntries(entries: BackupArchiveEntry[]) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  const stateEntry = byName.get('server/state.json');
  if (!manifestEntry || !stateEntry) throw new Error('快照缺少 manifest.json 或 server/state.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8')) as {
    format?: string;
    version?: number;
    schemaVersion?: number;
    canonical?: { workspace?: string };
    media?: { skipped?: number };
    files?: Array<{ name: string; bytes: number; sha256: string }>;
  };
  if (manifest.format !== SNAPSHOT_FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('快照格式不受支持');
  const legacyWorkspaceEntry = manifest.schemaVersion === undefined;
  if (!legacyWorkspaceEntry && (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || manifest.canonical?.workspace !== 'client/client.json')) {
    throw new Error('快照 schema 版本或 canonical workspace 无效');
  }
  const expected = new Map(manifest.files.map((entry) => [entry.name, entry]));
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const expectedEntry = expected.get(entry.name);
    if (!expectedEntry || expectedEntry.bytes !== entry.data.byteLength || expectedEntry.sha256 !== sha256(entry.data)) throw new Error(`快照校验失败：${entry.name}`);
  }
  if (expected.size !== entries.length - 1) throw new Error('快照缺少文件');
  const state = JSON.parse(stateEntry.data.toString('utf8')) as { providers?: unknown; models?: unknown; settings?: Record<string, unknown> };
  if (!Array.isArray(state.providers) || !Array.isArray(state.models) || !state.settings || typeof state.settings !== 'object') throw new Error('快照中的服务端配置格式无效');
  const workspaceEntry = byName.get('client/client.json') || (legacyWorkspaceEntry ? byName.get('server/workspace.json') : undefined);
  if (workspaceEntry) validateWorkspaceShape(JSON.parse(workspaceEntry.data.toString('utf8')));
  return { byName, state, legacyWorkspaceEntry, manifest };
}

export async function restoreLocalSnapshot(snapshotPath: string, configuredStoragePath = '') {
  if (!existsSync(snapshotPath)) throw new Error('快照文件不存在');
  const encrypted = await readFile(snapshotPath);
  const entries = await extractBackupArchiveStreaming(decryptBackupPayload(encrypted, await snapshotPassword()));
  const { byName, state, legacyWorkspaceEntry, manifest } = validateEntries(entries);
  state.settings = { ...state.settings, imageStoragePath: configuredStoragePath };
  await mkdir(dataDir, { recursive: true });
  await mkdir(providerConfigDir, { recursive: true });
  const transaction = new BackupRestoreTransaction(dataDir, `snapshot-${process.pid}-${Date.now()}`);
  try {
    await transaction.write(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const restoredLogs = entries.filter((entry) => entry.name.startsWith('server/logs/') && entry.name.endsWith('.jsonl'));
    for (const name of (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value))) await transaction.remove(path.join(dataDir, name));
    for (const entry of restoredLogs) await transaction.write(path.join(dataDir, path.basename(entry.name)), entry.data);
    let restoredTasks = 0;
    for (const name of SNAPSHOT_DURABLE_FILES) {
      const entry = byName.get(`server/tasks/${name}`);
      if (!entry) continue;
      await transaction.write(path.join(dataDir, name), entry.data);
      restoredTasks += 1;
    }
    const mcpConfig = byName.get('server/mcp/servers.json');
    if (mcpConfig) await transaction.write(path.join(dataDir, 'mcp', 'servers.json'), mcpConfig.data);
    const masterKey = byName.get('server/master.key');
    if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await transaction.write(keyPath, masterKey.data);
    const workspace = byName.get('client/client.json') || (legacyWorkspaceEntry ? byName.get('server/workspace.json') : undefined);
    if (workspace) await transaction.write(workspacePath, workspace.data);
    const imageRoot = path.resolve(configuredStoragePath.trim() || getDefaultStoragePath());
    const videoRoot = path.resolve(process.env.SANMAO_VIDEO_STORAGE_PATH?.trim() || getDefaultVideoStoragePath());
    const audioRoot = path.resolve(process.env.SANMAO_AUDIO_STORAGE_PATH?.trim() || getDefaultAudioStoragePath());
    const restoredImages = await restoreSnapshotMedia(transaction, entries, 'images', imageRoot, SNAPSHOT_MEDIA_PATTERNS.images);
    const restoredVideos = await restoreSnapshotMedia(transaction, entries, 'videos', videoRoot, SNAPSHOT_MEDIA_PATTERNS.videos);
    const restoredAudio = await restoreSnapshotMedia(transaction, entries, 'audio', audioRoot, SNAPSHOT_MEDIA_PATTERNS.audio);
    await transaction.commit();
    return { restoredImages, restoredVideos, restoredAudio, restoredTasks, restoredMcpConfig: Boolean(mcpConfig), restoredWorkspace: Boolean(workspace), skippedMediaCount: Number(manifest.media?.skipped || 0), state };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/** 把快照里的某一类媒体写回目标目录，路径一律限制在目标目录内。 */
async function restoreSnapshotMedia(transaction: BackupRestoreTransaction, entries: BackupArchiveEntry[], folder: 'images' | 'videos' | 'audio', root: string, pattern: RegExp) {
  await mkdir(root, { recursive: true });
  let restored = 0;
  for (const entry of entries.filter((value) => value.name.startsWith(`${folder}/`))) {
    const relative = entry.name.slice(folder.length + 1).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !pattern.test(relative)) continue;
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await transaction.write(target, entry.data);
    restored += 1;
  }
  return restored;
}

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createBackupArchive, extractBackupArchive, type BackupArchiveEntry } from './backup-archive';
import { decryptBackupPayload, encryptBackupPayload } from './backup-crypto';
import { getDefaultStoragePath, getStorageRoots } from './image-storage';
import { getDefaultAudioStoragePath, getAudioStorageRoots } from './audio-storage';
import { getDefaultVideoStoragePath, getVideoStorageRoots } from './video-storage';
import { encryptSecret } from './store';
import { resolveLocalDataDir, resolveProviderConfigDir } from './data-paths';

const dataDir = resolveLocalDataDir();
const providerConfigDir = resolveProviderConfigDir();
const snapshotDir = path.join(dataDir, 'backups', 'auto');
const statePath = path.join(providerConfigDir, 'state.json');
const workspacePath = path.join(dataDir, 'workspace.json');
const keyPath = path.join(providerConfigDir, 'master.key');
const SNAPSHOT_FORMAT = 'sanmao-ai-auto-snapshot';
const KEEP_SNAPSHOTS = 7;
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

async function collectSnapshotMedia(
  entries: BackupArchiveEntry[],
  settings: { imageStoragePath?: string; videoStoragePath?: string },
): Promise<SnapshotMediaStats> {
  const stats: SnapshotMediaStats = { videos: 0, audio: 0, images: 0, skipped: 0 };
  const seen = new Set<string>();
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
    for (const root of target.roots) {
      for (const file of await listFiles(root)) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (!relative || seen.has(relative) || !target.pattern.test(relative)) continue;
        seen.add(relative);
        let size = 0;
        try { size = (await stat(file)).size; } catch { continue; }
        if (size <= 0 || size > MAX_SNAPSHOT_MEDIA_FILE_BYTES || size > budget) { stats.skipped += 1; continue; }
        try {
          entries.push({ name: `${target.folder}/${relative}`, data: await readFile(file) });
          budget -= size;
          stats[target.folder] += 1;
        } catch { stats.skipped += 1; }
      }
    }
  }
  return stats;
}
let snapshotInFlight: Promise<{ path: string; createdAt: string; bytes: number; imageCount: number; reason: string }> | null = null;

function hash(data: Buffer) { return createHash('sha256').update(data).digest('hex'); }
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
  const entries: BackupArchiveEntry[] = [];
  const state = await readFile(statePath).catch(() => Buffer.from(JSON.stringify({ schemaVersion: 2, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } }, null, 2)));
  entries.push({ name: 'server/state.json', data: state });
  const workspace = await readFile(workspacePath).catch(() => Buffer.alloc(0));
  if (workspace.length) entries.push({ name: 'server/workspace.json', data: workspace });
  const key = await readFile(keyPath).catch(() => Buffer.alloc(0));
  if (key.length) entries.push({ name: 'server/master.key', data: key });
  for (const name of (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value))) {
    entries.push({ name: `server/logs/${name}`, data: await readFile(path.join(dataDir, name)) });
  }
  const stateObject = JSON.parse(state.toString('utf8')) as { settings?: { imageStoragePath?: string; videoStoragePath?: string } };
  const media = await collectSnapshotMedia(entries, stateObject.settings || {});
  const manifest = {
    format: SNAPSHOT_FORMAT,
    version: 1,
    reason,
    createdAt: new Date().toISOString(),
    media,
    files: entries.map((entry) => ({ name: entry.name, bytes: entry.data.byteLength, sha256: hash(entry.data) })),
  };
  const archive = createBackupArchive([{ name: 'manifest.json', data: jsonBuffer(manifest) }, ...entries]);
  const encrypted = encryptBackupPayload(archive, await snapshotPassword());
  const file = path.join(snapshotDir, snapshotName());
  await writeFile(file, encrypted, { flag: 'wx', flush: true });
  const snapshots = await listLocalSnapshots();
  for (const old of snapshots.slice(KEEP_SNAPSHOTS)) await rm(old.path, { force: true });
  return {
    path: file,
    createdAt: manifest.createdAt,
    bytes: encrypted.byteLength,
    imageCount: media.images,
    videoCount: media.videos,
    audioCount: media.audio,
    skippedMediaCount: media.skipped,
    reason,
  };
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
  return createLocalSnapshot('scheduled');
}

export async function listLocalSnapshots() {
  const result: Array<{ name: string; path: string; createdAt: string; bytes: number }> = [];
  for (const name of await readdir(snapshotDir).catch(() => [])) {
    if (!/^snapshot-.*\.sanmao-snapshot$/.test(name)) continue;
    const file = path.join(snapshotDir, name);
    try {
      const info = await stat(file);
      result.push({ name, path: file, createdAt: new Date(info.mtimeMs).toISOString(), bytes: info.size });
    } catch {}
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function validateEntries(entries: BackupArchiveEntry[]) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  const stateEntry = byName.get('server/state.json');
  if (!manifestEntry || !stateEntry) throw new Error('快照缺少 manifest.json 或 server/state.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8')) as { format?: string; version?: number; files?: Array<{ name: string; bytes: number; sha256: string }> };
  if (manifest.format !== SNAPSHOT_FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('快照格式不受支持');
  const expected = new Map(manifest.files.map((entry) => [entry.name, entry]));
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const expectedEntry = expected.get(entry.name);
    if (!expectedEntry || expectedEntry.bytes !== entry.data.byteLength || expectedEntry.sha256 !== hash(entry.data)) throw new Error(`快照校验失败：${entry.name}`);
  }
  if (expected.size !== entries.length - 1) throw new Error('快照缺少文件');
  const state = JSON.parse(stateEntry.data.toString('utf8')) as { providers?: unknown; models?: unknown; settings?: Record<string, unknown> };
  if (!Array.isArray(state.providers) || !Array.isArray(state.models) || !state.settings || typeof state.settings !== 'object') throw new Error('快照中的服务端配置格式无效');
  return { byName, state };
}

export async function restoreLocalSnapshot(snapshotPath: string, configuredStoragePath = '') {
  if (!existsSync(snapshotPath)) throw new Error('快照文件不存在');
  const encrypted = await readFile(snapshotPath);
  const entries = extractBackupArchive(decryptBackupPayload(encrypted, await snapshotPassword()));
  const { byName, state } = validateEntries(entries);
  state.settings = { ...state.settings, imageStoragePath: configuredStoragePath };
  await mkdir(dataDir, { recursive: true });
  await mkdir(providerConfigDir, { recursive: true });
  await writeFile(`${statePath}.snapshot.tmp`, `${JSON.stringify(state, null, 2)}\n`, { flush: true });
  const restoredLogs = entries.filter((entry) => entry.name.startsWith('server/logs/') && entry.name.endsWith('.jsonl'));
  for (const name of (await readdir(dataDir).catch(() => [])).filter((value) => /^generation-logs(?:-\d+)?\.jsonl$/.test(value))) await rm(path.join(dataDir, name), { force: true });
  for (const entry of restoredLogs) await writeFile(path.join(dataDir, path.basename(entry.name)), entry.data);
  const masterKey = byName.get('server/master.key');
  if (masterKey && !process.env.SANMAO_MASTER_KEY?.trim()) await writeFile(keyPath, masterKey.data, { flush: true });
  const workspace = byName.get('server/workspace.json');
  if (workspace) await writeFile(`${workspacePath}.snapshot.tmp`, workspace.data, { flush: true });
  const imageRoot = path.resolve(configuredStoragePath.trim() || getDefaultStoragePath());
  const videoRoot = path.resolve(process.env.SANMAO_VIDEO_STORAGE_PATH?.trim() || getDefaultVideoStoragePath());
  const audioRoot = path.resolve(process.env.SANMAO_AUDIO_STORAGE_PATH?.trim() || getDefaultAudioStoragePath());
  const restoredImages = await restoreSnapshotMedia(entries, 'images', imageRoot, SNAPSHOT_MEDIA_PATTERNS.images);
  const restoredVideos = await restoreSnapshotMedia(entries, 'videos', videoRoot, SNAPSHOT_MEDIA_PATTERNS.videos);
  const restoredAudio = await restoreSnapshotMedia(entries, 'audio', audioRoot, SNAPSHOT_MEDIA_PATTERNS.audio);
  await rename(`${statePath}.snapshot.tmp`, statePath);
  if (workspace) await rename(`${workspacePath}.snapshot.tmp`, workspacePath);
  return { restoredImages, restoredVideos, restoredAudio, restoredWorkspace: Boolean(workspace), state };
}

/** 把快照里的某一类媒体写回目标目录，路径一律限制在目标目录内。 */
async function restoreSnapshotMedia(entries: BackupArchiveEntry[], folder: 'images' | 'videos' | 'audio', root: string, pattern: RegExp) {
  await mkdir(root, { recursive: true });
  let restored = 0;
  for (const entry of entries.filter((value) => value.name.startsWith(`${folder}/`))) {
    const relative = entry.name.slice(folder.length + 1).replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || !pattern.test(relative)) continue;
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
    restored += 1;
  }
  return restored;
}

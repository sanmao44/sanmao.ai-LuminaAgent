import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from './data-paths';
import {
  MEDIA_DIRECTORY_NAMES,
  MEDIA_KINDS,
  knownMediaRoots,
  mediaDirectory,
  rememberMediaRoot,
  resolveMediaRootDir,
  type MediaKind,
} from './media-paths';

/** 各媒体类型的可落库扩展名，复制旧素材时只搬运真正属于该类媒体的文件。 */
const MEDIA_EXTENSIONS: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|webp|gif|bmp)$/i,
  video: /\.(mp4|webm|mov|m4v|ogv)$/i,
  audio: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i,
};

const ENV_STORAGE_KEYS: Record<MediaKind, string> = {
  image: 'SANMAO_IMAGE_STORAGE_PATH',
  video: 'SANMAO_VIDEO_STORAGE_PATH',
  audio: 'SANMAO_AUDIO_STORAGE_PATH',
};

/** 单次复制上限保护：超过 1GB 的单个文件仍会复制，但避免异常文件拖垮启动。 */
const MAX_MEDIA_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export type MediaLibrarySummary = {
  root: string;
  copied: Record<MediaKind, number>;
  present: Record<MediaKind, number>;
  sources: Record<MediaKind, string[]>;
  enabled: boolean;
};

function emptyCounters() {
  return { image: 0, video: 0, audio: 0 } as Record<MediaKind, number>;
}

function uniquePaths(values: Array<string | undefined>) {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    if (!result.includes(resolved)) result.push(resolved);
  }
  return result;
}

/** 每类媒体的历史目录候选：旧运行目录的 .data、旧版 image_generation_records、以及注册表里的目录。 */
export function mediaSourceRoots(kind: MediaKind, cwd = process.cwd()) {
  const localData = resolveLocalDataDir(cwd);
  const directory = MEDIA_DIRECTORY_NAMES[kind];
  return uniquePaths([
    kind === 'image' ? path.join(cwd, '..', 'image_generation_records') : '',
    process.env[ENV_STORAGE_KEYS[kind]],
    path.join(localData, directory),
    path.join(localData, 'media', directory),
    ...knownMediaRoots(kind, cwd),
  ]);
}

async function listMediaFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listMediaFiles(target, depth + 1));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function mergeKind(kind: MediaKind, target: string, copyEnabled: boolean) {
  const summary = { copied: 0, present: 0, sources: [] as string[] };
  const pattern = MEDIA_EXTENSIONS[kind];
  for (const source of mediaSourceRoots(kind)) {
    if (path.resolve(source) === path.resolve(target) || !existsSync(source)) continue;
    summary.sources.push(source);
    rememberMediaRoot(kind, source);
    if (!copyEnabled) continue;
    for (const file of await listMediaFiles(source)) {
      const name = path.basename(file);
      if (!pattern.test(name)) continue;
      const destination = path.join(target, name);
      if (existsSync(destination)) {
        summary.present += 1;
        continue;
      }
      try {
        const { size } = await stat(file);
        if (size > MAX_MEDIA_FILE_BYTES) continue;
        await copyFile(file, destination, constants.COPYFILE_EXCL);
        summary.copied += 1;
      } catch { /* 单个文件复制失败（占用/权限）不应影响其余素材。 */ }
    }
  }
  return summary;
}

let mergeInFlight: { key: string; promise: Promise<MediaLibrarySummary> } | null = null;

/**
 * 把历史运行目录里的媒体并入固定媒体库（只复制、不删除、同名跳过）。
 * 即使复制被跳过，注册表也会让 /api/storage/* 继续从旧目录读取素材。
 */
export async function ensureMediaLibrary(): Promise<MediaLibrarySummary> {
  const key = resolveMediaRootDir();
  if (mergeInFlight?.key === key) return mergeInFlight.promise;
  const promise = runMediaLibraryMerge().catch(() => ({
    root: resolveMediaRootDir(),
    copied: emptyCounters(),
    present: emptyCounters(),
    sources: { image: [], video: [], audio: [] } as Record<MediaKind, string[]>,
    enabled: false,
  }));
  mergeInFlight = { key, promise };
  return promise;
}

/** 真正执行一次并入；ensureMediaLibrary 会按媒体库根做进程内去重。 */
export async function runMediaLibraryMerge(): Promise<MediaLibrarySummary> {
  const root = resolveMediaRootDir();
  const copyEnabled = process.env.SANMAO_MEDIA_LIBRARY_COPY !== '0';
  const summary: MediaLibrarySummary = {
    root,
    copied: emptyCounters(),
    present: emptyCounters(),
    sources: { image: [], video: [], audio: [] } as Record<MediaKind, string[]>,
    enabled: copyEnabled,
  };
  for (const kind of MEDIA_KINDS) {
    const target = mediaDirectory(kind);
    // 用户显式配置过存储路径时尊重其选择，只登记目录用于回退。
    const explicit = String(process.env[ENV_STORAGE_KEYS[kind]] || '').trim();
    if (copyEnabled && !explicit) {
      try { await mkdir(target, { recursive: true }); } catch { /* 目录创建失败时后续复制会自然跳过。 */ }
    }
    const result = await mergeKind(kind, target, copyEnabled && !explicit);
    summary.copied[kind] = result.copied;
    summary.present[kind] = result.present;
    summary.sources[kind] = result.sources;
  }
  return summary;
}

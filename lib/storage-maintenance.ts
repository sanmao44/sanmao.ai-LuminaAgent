import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getStorageRoots } from './image-storage';
import { getVideoStorageRoots } from './video-storage';
import { getAudioStorageRoots } from './audio-storage';
import { resolveLocalDataDir } from './data-paths';

const dataDir = resolveLocalDataDir();

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_FILE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;

type FolderUsage = { files: number; bytes: number; latestMs: number };

async function folderBytes(root: string, match?: RegExp): Promise<FolderUsage> {
  let files = 0;
  let bytes = 0;
  let latestMs = 0;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const nested = await folderBytes(file, match);
        files += nested.files; bytes += nested.bytes; latestMs = Math.max(latestMs, nested.latestMs);
      } else if (entry.isFile() && (!match || match.test(entry.name))) {
        const info = await stat(file);
        files += 1; bytes += info.size; latestMs = Math.max(latestMs, info.mtimeMs);
      }
    }
  } catch {}
  return { files, bytes, latestMs };
}

/** 同一类素材可能散落在多个历史目录，逐个累加后只对外暴露一份总计。 */
async function rootsUsage(roots: string[], match: RegExp): Promise<FolderUsage> {
  const total: FolderUsage = { files: 0, bytes: 0, latestMs: 0 };
  for (const root of roots) {
    const current = await folderBytes(root, match);
    total.files += current.files;
    total.bytes += current.bytes;
    total.latestMs = Math.max(total.latestMs, current.latestMs);
  }
  return total;
}

function usageView(usage: FolderUsage, withLatest = true) {
  return withLatest
    ? { files: usage.files, bytes: usage.bytes, latestAt: usage.latestMs ? new Date(usage.latestMs).toISOString() : null }
    : { files: usage.files, bytes: usage.bytes };
}

export async function getStorageUsage(configuredPath = '', configuredVideoPath = '') {
  // 视频和音频此前完全没进统计，界面上的“占用”会明显小于实际磁盘占用。
  const [images, videos, audio] = await Promise.all([
    rootsUsage(getStorageRoots(configuredPath), IMAGE_FILE),
    rootsUsage(getVideoStorageRoots(configuredVideoPath), VIDEO_FILE),
    rootsUsage(getAudioStorageRoots(), AUDIO_FILE),
  ]);
  const logNames = (await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name));
  const logSizes = await Promise.all(logNames.map(async (name) => (await stat(path.join(dataDir, name)).catch(() => ({ size: 0 }))).size));
  const snapshots = await folderBytes(path.join(dataDir, 'backups', 'auto'));
  const trash = await folderBytes(path.join(dataDir, 'trash'));
  const artifacts = await folderBytes(path.join(dataDir, 'artifacts'));
  return {
    images: usageView(images),
    videos: usageView(videos),
    audio: usageView(audio),
    logs: { files: logNames.length, bytes: logSizes.reduce((sum, value) => sum + value, 0) },
    snapshots: usageView(snapshots, false),
    trash: usageView(trash, false),
    artifacts: usageView(artifacts),
    totalBytes: images.bytes + videos.bytes + audio.bytes + snapshots.bytes + trash.bytes + artifacts.bytes,
  };
}

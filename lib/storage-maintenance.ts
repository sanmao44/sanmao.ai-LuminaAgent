import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getStorageRoots } from './image-storage';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');

async function folderBytes(root: string, imageOnly = false): Promise<{ files: number; bytes: number; latestMs: number }> {
  let files = 0;
  let bytes = 0;
  let latestMs = 0;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const nested = await folderBytes(file, imageOnly);
        files += nested.files; bytes += nested.bytes; latestMs = Math.max(latestMs, nested.latestMs);
      } else if (entry.isFile() && (!imageOnly || /\.(png|jpe?g|webp)$/i.test(entry.name))) {
        const info = await stat(file);
        files += 1; bytes += info.size; latestMs = Math.max(latestMs, info.mtimeMs);
      }
    }
  } catch {}
  return { files, bytes, latestMs };
}

export async function getStorageUsage(configuredPath = '') {
  const imageRoots = getStorageRoots(configuredPath);
  const images = { files: 0, bytes: 0, latestMs: 0 };
  for (const root of imageRoots) {
    const current = await folderBytes(root, true);
    images.files += current.files; images.bytes += current.bytes; images.latestMs = Math.max(images.latestMs, current.latestMs);
  }
  const logs = await folderBytes(dataDir);
  const snapshots = await folderBytes(path.join(dataDir, 'backups', 'auto'));
  const trash = await folderBytes(path.join(dataDir, 'trash'));
  return {
    images: { files: images.files, bytes: images.bytes, latestAt: images.latestMs ? new Date(images.latestMs).toISOString() : null },
    logs: { files: (await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name)).length, bytes: (await Promise.all((await readdir(dataDir).catch(() => [])).filter((name) => /^generation-logs(?:-\d+)?\.jsonl$/.test(name)).map(async (name) => (await stat(path.join(dataDir, name)).catch(() => ({ size: 0 }))).size))).reduce((sum, value) => sum + value, 0) },
    snapshots: { files: snapshots.files, bytes: snapshots.bytes },
    trash: { files: trash.files, bytes: trash.bytes },
    totalBytes: images.bytes + snapshots.bytes + trash.bytes,
  };
}


import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLocalDataDir } from '../data-paths';
import { ARCHIVE_MAX_BYTES, ARTIFACT_MAX_BYTES, ARTIFACT_ROOT_MAX_BYTES, ARTIFACT_TTL_MS } from './limits';
import { isValidArtifactId, resolveArtifactChild, sanitizeArtifactFileName } from './sanitize';
import { ARTIFACT_EXTENSIONS, ARTIFACT_MIME_TYPES, artifactDownloadUrl, type ArtifactDescriptor, type ArtifactKind } from './types';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export type ArtifactMeta = {
  id: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
};

export type ArtifactStored = {
  descriptor: ArtifactDescriptor;
  filePath: string;
};

export type ArtifactSaveInput = {
  kind: ArtifactKind;
  name: string;
  data: Buffer;
  mimeType?: string;
};

export type ArtifactStore = {
  root: string;
  save: (input: ArtifactSaveInput) => Promise<ArtifactDescriptor>;
  read: (id: string) => Promise<ArtifactStored | null>;
  list: (ids: readonly string[]) => Promise<ArtifactStored[]>;
  usage: () => Promise<{ files: number; bytes: number }>;
  cleanup: (options?: { maxAgeMs?: number; maxTotalBytes?: number; protect?: readonly string[] }) => Promise<{ removed: number; removedBytes: number; files: number; bytes: number }>;
};

function monthBucket(at: number) {
  return new Date(at).toISOString().slice(0, 7);
}

function metaFileName() {
  return 'meta.json';
}

function kindFromExtension(fileName: string): ArtifactKind | null {
  const lower = fileName.toLowerCase();
  const entry = (Object.keys(ARTIFACT_EXTENSIONS) as ArtifactKind[]).find(
    (kind) => ARTIFACT_EXTENSIONS[kind] !== '' && lower.endsWith(ARTIFACT_EXTENSIONS[kind]),
  );
  // 认不出扩展名的按「原样收下的文件」兜底：浏览器下载的 pdf、png 都归这一类。
  return entry || (path.extname(lower) ? 'file' : null);
}

async function writeAtomic(file: string, data: Buffer) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readDirectoryNames(root: string) {
  return readdir(root, { withFileTypes: true }).catch(() => []);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toDescriptor(meta: ArtifactMeta): ArtifactDescriptor {
  return {
    id: meta.id,
    kind: meta.kind,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    downloadUrl: artifactDownloadUrl(meta.id),
    createdAt: meta.createdAt,
  };
}

export function createArtifactStore(options: { root?: string; cleanup?: boolean; now?: () => number } = {}): ArtifactStore {
  const root = options.root ? path.resolve(options.root) : path.join(resolveLocalDataDir(), 'artifacts');
  const cleanupEnabled = options.cleanup !== false;
  const now = options.now || (() => Date.now());
  let lastCleanupAt = 0;

  async function artifactDirs() {
    const names = await readDirectoryNames(root);
    const dirs: string[] = [];
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      if (MONTH_PATTERN.test(entry.name)) {
        const months = await readDirectoryNames(path.join(root, entry.name));
        for (const month of months) {
          if (month.isDirectory() && isValidArtifactId(month.name)) dirs.push(path.join(root, entry.name, month.name));
        }
        continue;
      }
      if (isValidArtifactId(entry.name)) dirs.push(path.join(root, entry.name));
    }
    return dirs;
  }

  async function readDirectory(dir: string): Promise<ArtifactStored | null> {
    const dirName = path.basename(dir);
    const meta = await readJson<ArtifactMeta>(path.join(dir, metaFileName()));
    if (meta && isValidArtifactId(meta.id)) {
      const filePath = path.join(dir, sanitizeArtifactFileName(meta.name, 'artifact', [ARTIFACT_EXTENSIONS[meta.kind]]));
      const info = await stat(filePath).catch(() => null);
      if (info?.isFile()) return { descriptor: toDescriptor(meta), filePath };
    }
    // meta.json 缺失时按目录里唯一的文件兜底，避免半成品记录直接丢件。
    const entries = await readDirectoryNames(dir);
    const files = entries.filter((entry) => entry.isFile() && entry.name !== metaFileName());
    if (files.length !== 1) return null;
    const name = files[0].name;
    const kind = kindFromExtension(name);
    if (!kind) return null;
    const filePath = path.join(dir, name);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return null;
    const createdAt = info.mtimeMs;
    return {
      descriptor: { id: dirName, kind, name, mimeType: ARTIFACT_MIME_TYPES[kind], size: info.size, downloadUrl: artifactDownloadUrl(dirName), createdAt },
      filePath,
    };
  }

  async function cleanup(input: { maxAgeMs?: number; maxTotalBytes?: number; protect?: readonly string[] } = {}) {
    const maxAgeMs = input.maxAgeMs ?? ARTIFACT_TTL_MS;
    const maxTotalBytes = input.maxTotalBytes ?? ARTIFACT_ROOT_MAX_BYTES;
    const protect = new Set(input.protect || []);
    const entries: Array<{ dir: string; createdAt: number; bytes: number; id: string }> = [];
    for (const dir of await artifactDirs()) {
      const stored = await readDirectory(dir);
      if (!stored) continue;
      entries.push({ dir, createdAt: stored.descriptor.createdAt, bytes: stored.descriptor.size, id: stored.descriptor.id });
    }
    const at = now();
    let removed = 0;
    let removedBytes = 0;
    const survivors: typeof entries = [];
    for (const entry of entries) {
      if (!protect.has(entry.id) && at - entry.createdAt > maxAgeMs) {
        await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined);
        removed += 1;
        removedBytes += entry.bytes;
      } else {
        survivors.push(entry);
      }
    }
    let bytes = survivors.reduce((sum, entry) => sum + entry.bytes, 0);
    survivors.sort((left, right) => right.createdAt - left.createdAt);
    for (let index = survivors.length - 1; index >= 0 && bytes > maxTotalBytes; index -= 1) {
      const entry = survivors[index];
      if (protect.has(entry.id)) continue;
      await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined);
      bytes -= entry.bytes;
      removed += 1;
      removedBytes += entry.bytes;
      survivors.splice(index, 1);
    }
    return { removed, removedBytes, files: survivors.length, bytes };
  }

  async function readStored(id: string): Promise<ArtifactStored | null> {
    if (!isValidArtifactId(id)) return null;
    const trimmed = id.trim();
    const names = await readDirectoryNames(root);
    const candidates: string[] = [];
    for (const entry of names) {
      if (entry.isDirectory() && MONTH_PATTERN.test(entry.name)) candidates.push(path.join(root, entry.name, trimmed));
    }
    candidates.push(path.join(root, trimmed));
    for (const candidate of candidates) {
      const stored = await readDirectory(candidate);
      if (stored) return stored;
    }
    return null;
  }

  return {
    root,
    async save(input) {
      const limit = input.kind === 'archive' ? ARCHIVE_MAX_BYTES : ARTIFACT_MAX_BYTES;
      if (!input.data || input.data.length === 0) throw new Error('生成内容为空，已取消写入');
      if (input.data.length > limit) throw new Error(`生成文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限，请减少内容后重试`);
      const createdAt = now();
      const id = randomUUID();
      const extension = ARTIFACT_EXTENSIONS[input.kind];
      const name = sanitizeArtifactFileName(input.name, `SANMAO-${input.kind}`, [extension]);
      const dir = resolveArtifactChild(root, monthBucket(createdAt), id);
      try {
        await mkdir(dir, { recursive: true });
        const filePath = resolveArtifactChild(dir, name);
        await writeAtomic(filePath, input.data);
        const meta: ArtifactMeta = {
          id,
          kind: input.kind,
          name,
          mimeType: input.mimeType || ARTIFACT_MIME_TYPES[input.kind],
          size: input.data.length,
          createdAt,
        };
        await writeAtomic(path.join(dir, metaFileName()), Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
        if (cleanupEnabled && now() - lastCleanupAt > CLEANUP_INTERVAL_MS) {
          lastCleanupAt = now();
          void cleanup({ protect: [id] }).catch(() => undefined);
        }
        return toDescriptor(meta);
      } catch (error) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },
    read: readStored,
    async list(ids) {
      const unique = Array.from(new Set(ids.filter((id) => isValidArtifactId(id)))).slice(0, 64);
      const found = await Promise.all(unique.map((id) => readStored(id.trim())));
      return found.filter((item): item is ArtifactStored => Boolean(item));
    },
    async usage() {
      let files = 0;
      let bytes = 0;
      for (const dir of await artifactDirs()) {
        const stored = await readDirectory(dir);
        if (!stored) continue;
        files += 1;
        bytes += stored.descriptor.size;
      }
      return { files, bytes };
    },
    cleanup,
  };
}

export const artifactStore = createArtifactStore();

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** 画布与生成记录用到的三类媒体。 */
export type MediaKind = 'image' | 'video' | 'audio';

/** 媒体库内的子目录名；各 storage 模块默认根都指向这里。 */
export const MEDIA_DIRECTORY_NAMES: Record<MediaKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
};

export const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio'];

const REGISTRY_FILE = 'media-roots.json';
const MAX_REGISTERED_ROOTS = 24;

/**
 * 媒体库根目录。默认固定在用户目录下，与“当前运行目录”解耦：
 * 换版本文件夹（例如解压到 SANMAO.AI-0.7.50）时不会再换掉一整套素材，
 * 画布节点里的 `/api/storage/...?name=` 因而不会断链。
 * 可用 SANMAO_MEDIA_ROOT 覆盖（相对路径按 cwd 解析）。
 */
export function resolveMediaRootDir(cwd = process.cwd(), configured: string | undefined = process.env.SANMAO_MEDIA_ROOT) {
  const value = String(configured || '').trim();
  if (value) return path.resolve(cwd, value);
  let home = '';
  try { home = os.homedir(); } catch { home = ''; }
  if (home) return path.join(home, '.sanmao-ai', 'media');
  return path.join(cwd, '.data', 'media');
}

/** 某一类媒体的默认目录，例如 <mediaRoot>/images。 */
export function mediaDirectory(kind: MediaKind, cwd = process.cwd()) {
  return path.join(resolveMediaRootDir(cwd), MEDIA_DIRECTORY_NAMES[kind]);
}

function registryPath(cwd = process.cwd()) {
  return path.join(resolveMediaRootDir(cwd), REGISTRY_FILE);
}

type MediaRootRegistry = {
  version: number;
  updatedAt: string;
  roots: Record<string, string[]>;
  lookupOnlyRoots: Record<string, string[]>;
};

let registryCache: { file: string; value: MediaRootRegistry } | null = null;

function emptyRegistry(): MediaRootRegistry {
  return { version: 1, updatedAt: new Date(0).toISOString(), roots: {}, lookupOnlyRoots: {} };
}

function readRegistry(cwd = process.cwd()): MediaRootRegistry {
  const file = registryPath(cwd);
  if (registryCache?.file === file) return registryCache.value;
  let value = emptyRegistry();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<MediaRootRegistry>;
    if (parsed && typeof parsed === 'object' && parsed.roots && typeof parsed.roots === 'object') {
      const roots: Record<string, string[]> = {};
      const lookupOnlyRoots: Record<string, string[]> = {};
      for (const kind of MEDIA_KINDS) {
        const list = (parsed.roots as Record<string, unknown>)[kind];
        if (Array.isArray(list)) {
          roots[kind] = list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
        const lookupList = parsed.lookupOnlyRoots && typeof parsed.lookupOnlyRoots === 'object'
          ? (parsed.lookupOnlyRoots as Record<string, unknown>)[kind]
          : undefined;
        if (Array.isArray(lookupList)) {
          lookupOnlyRoots[kind] = lookupList.filter((item): item is string => typeof item === 'string' && Boolean(roots[kind]?.includes(item)));
        }
      }
      value = { version: 1, updatedAt: String(parsed.updatedAt || ''), roots, lookupOnlyRoots };
    }
  } catch { /* 注册表缺失或损坏时按空表处理，不影响默认目录。 */ }
  registryCache = { file, value };
  return value;
}

function writeRegistry(value: MediaRootRegistry, cwd = process.cwd()) {
  const file = registryPath(cwd);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
    registryCache = { file, value };
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(temporary, { force: true }); } catch { /* 清理失败不能破坏已有注册表。 */ }
  }
}

/** 历史上出现过的媒体目录，用于在固定媒体库之外继续找回旧素材。 */
export function knownMediaRoots(kind: MediaKind, cwd = process.cwd()) {
  return readRegistry(cwd).roots[kind] || [];
}

/** 用户选择的自定义目录只作读取回退，不能被历史素材迁移顺带复制。 */
export function lookupOnlyMediaRoots(kind: MediaKind, cwd = process.cwd()) {
  return readRegistry(cwd).lookupOnlyRoots[kind] || [];
}

/** 批量保留历史读取目录；lookupOnly 标记不改变已有媒体文件。 */
export function rememberMediaRoots(kind: MediaKind, roots: readonly (string | undefined)[], cwd = process.cwd(), options: { lookupOnly?: boolean } = {}) {
  const targets = [...new Set(roots.map((root) => String(root || '').trim()).filter(Boolean).map((root) => path.resolve(cwd, root)))];
  if (!targets.length) return true;
  const registry = readRegistry(cwd);
  const current = registry.roots[kind] || [];
  // 本次切换涉及的旧/新目录放到最近位置，不能在达到上限时把刚保留的旧目录挤掉。
  const next = [...current.filter((root) => !targets.includes(root)), ...targets].slice(-MAX_REGISTERED_ROOTS);
  const currentLookupOnly = registry.lookupOnlyRoots[kind] || [];
  const lookupOnly = [...new Set([...currentLookupOnly, ...(options.lookupOnly ? targets : [])])].filter((root) => next.includes(root));
  if (next.length === current.length && next.every((root, index) => root === current[index])
    && lookupOnly.length === currentLookupOnly.length && lookupOnly.every((root, index) => root === currentLookupOnly[index])) return true;
  const value2: MediaRootRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    roots: { ...registry.roots, [kind]: next },
    lookupOnlyRoots: { ...registry.lookupOnlyRoots, [kind]: lookupOnly },
  };
  return writeRegistry(value2, cwd);
}

/** 历史目录发现仍为 best effort；设置切换可用批量接口确认登记是否成功。 */
export function rememberMediaRoot(kind: MediaKind, root: string | undefined, cwd = process.cwd()) {
  rememberMediaRoots(kind, [root], cwd);
}

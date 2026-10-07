/**
 * 用户授权给「本地文件」服务的文件夹清单。
 *
 * 这份清单有双重身份：既是 Filesystem MCP 的启动参数，也是 SANMAO 侧放行路径的唯一依据
 * （见 lib/mcp/filesystem-policy.ts）。只靠服务端的 allowed-directories 不够——那只能证明
 * 服务自己没越界，证明不了模型这次给的路径正好是用户想开放的那个。
 *
 * 存 `.data/mcp/filesystem-roots.json`（0600）。读盘时会丢掉已经不存在/已不是目录的条目：
 * 宁可让服务起不来，也不要拿一个失效的路径做包含判断（外接盘拔掉后 D:\ 可能指向别的东西）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';

/** 授权目录上限：再多就不是「指定文件夹」，而是「整块盘」了。 */
export const MCP_MAX_FILESYSTEM_ROOTS = 8;

export function filesystemRootsDataDir(options: { dataDir?: string } = {}) {
  return options.dataDir || resolveLocalDataDir();
}

export function resolveFilesystemRootsFile(options: { dataDir?: string } = {}) {
  return path.join(filesystemRootsDataDir(options), 'mcp', 'filesystem-roots.json');
}

function canonicalPath(value: string) {
  let current = path.resolve(value);
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const resolved = realpathSync.native ? realpathSync.native(current) : realpathSync(current);
      return tail.length ? path.join(resolved, ...tail.reverse()) : resolved;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      tail.push(path.basename(current));
      current = parent;
    }
  }
  return path.resolve(value);
}

/** Windows 上大小写不敏感，`C:\A` 与 `c:\a` 是同一个目录；包含判断必须跟着这个规则走。 */
export function samePath(left: string, right: string, platform: string = process.platform) {
  const normalize = (value: string) => {
    const resolved = canonicalPath(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

/**
 * target 是否在 parent 里面（含 parent 本身）。
 * 两边都先 resolve 成绝对路径再比：`..` 在这里就被折叠掉了。
 */
export function isPathInside(target: string, parent: string, platform: string = process.platform) {
  const normalize = (value: string) => {
    const resolved = canonicalPath(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const inner = normalize(target);
  const outer = normalize(parent);
  if (inner === outer) return true;
  const relative = path.relative(outer, inner);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function realpath(value: string) {
  return realpathSync.native ? realpathSync.native(value) : realpathSync(value);
}

/**
 * 归一化一个授权目录：必须是已存在的文件夹，走 realpath 消掉符号链接/junction，
 * 去掉末尾分隔符。这里拒绝三类明显不该开放的路径：文件、磁盘根、应用自己的数据目录。
 */
export function normalizeFilesystemRoot(value: unknown, platform: string = process.platform) {
  const raw = String(value ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!raw) throw new Error('文件夹路径不能为空');
  if (!path.isAbsolute(raw)) throw new Error('请填写绝对路径，例如 D:\\文档 或 /Users/me/Documents');
  let resolved = '';
  try {
    resolved = realpath(raw);
  } catch {
    throw new Error(`找不到这个文件夹：${raw}`);
  }
  let info;
  try {
    info = statSync(resolved);
  } catch {
    throw new Error(`读不到这个文件夹：${raw}`);
  }
  if (!info.isDirectory()) throw new Error('只能授权文件夹，不能是单个文件');
  if (samePath(resolved, path.parse(resolved).root, platform)) throw new Error('不能把整个磁盘根目录交给助手，请选一个具体的文件夹');
  // Keep the user's spelling (notably Windows 8.3 aliases) in the saved
  // value. Security checks canonicalize both sides through `canonicalPath`,
  // so retaining this form does not weaken symlink/junction protection.
  const stable = path.resolve(raw);
  const trimmed = platform === 'win32' ? stable.replace(/[\\/]+$/, '') : stable.replace(/\/+$/, '');
  return trimmed || stable;
}

/**
 * 授权目录条目：读权限人人都有（授权本来就是为了让助手读），写权限要单独打开。
 *
 * 启动参数（Filesystem MCP 的允许目录）只吃路径，所以写权限完全由本机这一侧把关
 * （见 lib/mcp/filesystem-policy.ts）；只读目录仍然会作为 argv 传给服务，否则连读都用不了。
 */
export type FilesystemRoot = { path: string; write: boolean };

/**
 * 读授权目录。文件不存在、格式坏了、目录被删了都只是跳过，不影响其他条目：
 * 面板要能打开，助手也不该因为一个失效目录就整轮不可用。
 *
 * 兼容 v1：早期版本存的是字符串数组（没有写权限这种说法），升级上来一律按只读处理。
 */
export function readFilesystemRootEntries(options: { dataDir?: string } = {}): FilesystemRoot[] {
  const file = resolveFilesystemRootsFile(options);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const values = Array.isArray(parsed?.roots) ? parsed.roots : [];
    const entries: FilesystemRoot[] = [];
    for (const value of values) {
      const root = String(typeof value === 'string' ? value : value?.path ?? '').trim();
      if (!root || entries.some((item) => samePath(item.path, root))) continue;
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      // 只有显式写了 write:true 的条目才带写权限；v1 的字符串条目一律读-only。
      entries.push({ path: root, write: typeof value !== 'string' && value?.write === true });
      if (entries.length >= MCP_MAX_FILESYSTEM_ROOTS) break;
    }
    return entries;
  } catch {
    return [];
  }
}

/** 只要路径的视图：Filesystem 的启动参数、包含判断都按这一份走。 */
export function listFilesystemRoots(options: { dataDir?: string } = {}): string[] {
  return readFilesystemRootEntries(options).map((entry) => entry.path);
}

/** 勾了「写入」的目录：写类工具只认这一份清单，没勾的目录写操作一律拒绝。 */
export function listFilesystemWriteRoots(options: { dataDir?: string } = {}): string[] {
  return readFilesystemRootEntries(options)
    .filter((entry) => entry.write)
    .map((entry) => entry.path);
}

/**
 * 面板上的「常用位置」：用户要授权一个文件夹，不该先自己想清楚绝对路径怎么写。
 * 只列主目录下的桌面 / 文档 / 下载（真实存在的那些），不列主目录本身——
 * 一键把整个用户目录交给助手，权限比用户想给的大得多。
 */
const SUGGESTED_ROOT_NAMES = ['desktop', 'documents', 'downloads', '桌面', '文档', '下载'];

export function suggestFilesystemRoots(options: { home?: string; excluded?: readonly string[] } = {}) {
  const home = options.home || process.env.USERPROFILE || process.env.HOME || '';
  if (!home || !existsSync(home)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(home);
  } catch {
    return [];
  }
  const excluded = options.excluded || [];
  const suggestions: string[] = [];
  for (const name of entries) {
    if (!SUGGESTED_ROOT_NAMES.includes(name.toLowerCase())) continue;
    const candidate = path.join(home, name);
    try {
      if (!statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    // 已经授权过的不再重复出现；只给路径，加不加还是用户点一下才算。
    if (excluded.some((item) => samePath(item, candidate))) continue;
    suggestions.push(candidate);
  }
  return suggestions.sort();
}

function writeFilesystemRoots(entries: readonly FilesystemRoot[], options: { dataDir?: string } = {}) {
  const file = resolveFilesystemRootsFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  const roots = entries.map((entry) => ({ path: entry.path, write: entry.write === true }));
  writeFileSync(file, `${JSON.stringify({ version: 2, roots }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 授权目录必须由用户在面板里添加；助手侧的 MCP 管理工具不碰这份文件。
 * write 默认 false：新加的目录先是只读，写权限要用户再勾一次。
 */
export function addFilesystemRoot(value: unknown, options: { dataDir?: string; write?: boolean } = {}) {
  const root = normalizeFilesystemRoot(value);
  const dataDir = filesystemRootsDataDir(options);
  if (isPathInside(root, dataDir)) throw new Error('这个文件夹在应用自己的数据目录里，助手需要的是你的文档目录');
  const entries = readFilesystemRootEntries(options);
  const existing = entries.find((entry) => samePath(entry.path, root));
  // 已经授权过就只当「改写入开关」：点两次不该变成两条，也不该报错。
  if (existing) {
    if (existing.write === (options.write === true)) return entries.map((entry) => entry.path);
    return setFilesystemRootWrite(root, options.write === true, options);
  }
  if (entries.length >= MCP_MAX_FILESYSTEM_ROOTS) throw new Error(`最多授权 ${MCP_MAX_FILESYSTEM_ROOTS} 个文件夹`);
  const next = [...entries, { path: root, write: options.write === true }];
  writeFilesystemRoots(next, options);
  return next.map((entry) => entry.path);
}

/** 面板上勾/取消「写入」：只改这一个目录的标记，不影响其他目录。 */
export function setFilesystemRootWrite(value: unknown, write: boolean, options: { dataDir?: string } = {}) {
  const raw = String(value ?? '').trim();
  const entries = readFilesystemRootEntries(options);
  const target = entries.find((entry) => samePath(entry.path, raw));
  if (!target) throw new Error('这个文件夹还没有授权，先添加再谈写入');
  const next = entries.map((entry) => (samePath(entry.path, target.path) ? { path: entry.path, write: write === true } : entry));
  writeFilesystemRoots(next, options);
  return next.map((entry) => entry.path);
}

/**
 * 取消授权。入参来自面板上的那一行，已经是我们写进去的路径，
 * 所以这里按「同一个路径」匹配而不是重新做一次严格归一化（目录可能刚被删掉）。
 */
export function removeFilesystemRoot(value: unknown, options: { dataDir?: string } = {}) {
  const raw = String(value ?? '').trim();
  const entries = readFilesystemRootEntries(options);
  const target = entries.find((entry) => samePath(entry.path, raw));
  if (!target) return entries.map((entry) => entry.path);
  const next = entries.filter((entry) => !samePath(entry.path, target.path));
  writeFilesystemRoots(next, options);
  return next.map((entry) => entry.path);
}

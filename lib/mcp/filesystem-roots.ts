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

/** Windows 上大小写不敏感，`C:\A` 与 `c:\a` 是同一个目录；包含判断必须跟着这个规则走。 */
export function samePath(left: string, right: string, platform: string = process.platform) {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
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
    const resolved = path.resolve(value);
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
  const trimmed = platform === 'win32' ? resolved.replace(/[\\/]+$/, '') : resolved.replace(/\/+$/, '');
  return trimmed || resolved;
}

/**
 * 读授权目录。文件不存在、格式坏了、目录被删了都只是跳过，不影响其他条目：
 * 面板要能打开，助手也不该因为一个失效目录就整轮不可用。
 */
export function listFilesystemRoots(options: { dataDir?: string } = {}): string[] {
  const file = resolveFilesystemRootsFile(options);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const values = Array.isArray(parsed?.roots) ? parsed.roots : [];
    const roots: string[] = [];
    for (const value of values) {
      const root = String(value ?? '').trim();
      if (!root || roots.some((item) => samePath(item, root))) continue;
      try {
        if (statSync(root).isDirectory()) roots.push(root);
      } catch {}
      if (roots.length >= MCP_MAX_FILESYSTEM_ROOTS) break;
    }
    return roots;
  } catch {
    return [];
  }
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

function writeFilesystemRoots(roots: readonly string[], options: { dataDir?: string } = {}) {
  const file = resolveFilesystemRootsFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, roots: [...roots] }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** 授权目录必须由用户在面板里添加；助手侧的 MCP 管理工具不碰这份文件。 */
export function addFilesystemRoot(value: unknown, options: { dataDir?: string } = {}) {
  const root = normalizeFilesystemRoot(value);
  const dataDir = filesystemRootsDataDir(options);
  if (isPathInside(root, dataDir)) throw new Error('这个文件夹在应用自己的数据目录里，助手需要的是你的文档目录');
  const roots = listFilesystemRoots(options);
  if (roots.some((item) => samePath(item, root))) return roots;
  if (roots.length >= MCP_MAX_FILESYSTEM_ROOTS) throw new Error(`最多授权 ${MCP_MAX_FILESYSTEM_ROOTS} 个文件夹`);
  const next = [...roots, root];
  writeFilesystemRoots(next, options);
  return next;
}

/**
 * 取消授权。入参来自面板上的那一行，已经是我们写进去的路径，
 * 所以这里按「同一个路径」匹配而不是重新做一次严格归一化（目录可能刚被删掉）。
 */
export function removeFilesystemRoot(value: unknown, options: { dataDir?: string } = {}) {
  const raw = String(value ?? '').trim();
  const roots = listFilesystemRoots(options);
  const target = roots.find((root) => samePath(root, raw)) || '';
  if (!target) return roots;
  const next = roots.filter((root) => !samePath(root, target));
  writeFilesystemRoots(next, options);
  return next;
}
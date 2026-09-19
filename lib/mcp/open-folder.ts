/**
 * 「打开文件夹」：面板上的授权目录和运行时安装目录，点一下交给系统文件管理器。
 *
 * 浏览器拿不到本机目录，所以这一步只能由本机服务端做。两个入口都不接受任意路径：
 * 授权目录必须先在授权清单里出现过，运行时目录由条目 id 从代码里算出来。
 * 参数以数组形式进 spawn、不走 shell——路径里有空格、引号、& 都不会变成命令。
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { findCatalogEntry, isStdioCatalogEntry, resolveCatalogInstallRoot } from './catalog';
import { listFilesystemRoots, samePath } from './filesystem-roots';

export type FolderOpenOptions = { dataDir?: string; platform?: string; spawnImpl?: typeof spawn };

/** 各平台的打开方式写死：Windows 用资源管理器，macOS 用 open，其余用 xdg-open。 */
export function folderOpenCommand(folder: string, platform: string = process.platform) {
  if (platform === 'win32') return { command: 'explorer.exe', args: [folder] };
  if (platform === 'darwin') return { command: 'open', args: [folder] };
  return { command: 'xdg-open', args: [folder] };
}

function requireFolder(folder: string) {
  let info;
  try {
    info = statSync(folder);
  } catch {
    throw new Error(`找不到这个文件夹：${folder}`);
  }
  if (!info.isDirectory()) throw new Error('只能打开文件夹，不能是单个文件');
  return folder;
}

/** 真正打开的那一步：尽力而为，打不开也不该把服务端带崩。 */
export function openLocalFolder(folder: string, options: FolderOpenOptions = {}) {
  requireFolder(folder);
  const { command, args } = folderOpenCommand(folder, options.platform);
  const spawnImpl = options.spawnImpl || spawn;
  const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  // 系统里没有这个命令（精简的 Linux 桌面）：吞掉错误，不然一次点击会变成 500。
  child.on('error', () => undefined);
  child.unref();
  return folder;
}

/** 授权目录：入参来自面板那一行，必须仍然在授权清单里，否则一律拒绝。 */
export function openFilesystemRoot(value: unknown, options: FolderOpenOptions = {}) {
  const raw = String(value ?? '').trim();
  const folder = listFilesystemRoots(options).find((root) => samePath(root, raw));
  if (!folder) throw new Error('只能打开已经授权的文件夹；要打开别的目录，先在上面添加授权。');
  return openLocalFolder(folder, options);
}

/** 运行时安装目录：路径由代码算出（resolveCatalogInstallRoot），面板只能传条目 id。 */
export function openCatalogFolder(id: unknown, options: FolderOpenOptions = {}) {
  const entry = findCatalogEntry(id);
  if (!entry || !isStdioCatalogEntry(entry)) throw new Error(`未知的本地服务：${String(id || '')}`);
  const folder = resolveCatalogInstallRoot(entry.id, options);
  if (!existsSync(folder)) throw new Error('这个运行时还没安装，装完才有目录。');
  return openLocalFolder(folder, options);
}
/**
 * 「打开文件夹」：面板上的授权目录和运行时安装目录，点一下交给系统文件管理器。
 *
 * 浏览器拿不到本机目录，所以这一步只能由本机服务端做。两个入口都不接受任意路径：
 * 授权目录必须先在授权清单里出现过，运行时目录由条目 id 从代码里算出来。
 * 参数以数组形式进 spawn、不走 shell——路径里有空格、引号、& 都不会变成命令。
 *
 * spawn 的选项只能给 detached + stdio: 'ignore'，**不要加 windowsHide**：
 * 加了之后 Windows 按 SW_HIDE 创建子进程，资源管理器接手的那个文件夹窗口是隐形的
 * （实测 IsWindowVisible=False）——用户点了按钮只觉得「什么都没发生」。
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { findCatalogEntry, isStdioCatalogEntry, resolveCatalogInstallRoot } from './catalog';
import { resolveLocalDataDir } from '@/lib/data-paths';
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

/**
 * 真正打开的那一步：等 spawn 的结果再回话。
 * 「已打开」但其实什么都没发生，比直接报错更难查——所以命令不存在这类失败要让面板说出来。
 */
function spawnFolderOpener(spawnImpl: typeof spawn, command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { detached: true, stdio: 'ignore' });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('打开文件夹失败'));
      return;
    }
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.once('error', (error) => finish(error instanceof Error ? error : new Error('打开文件夹失败')));
    child.once('spawn', () => finish(null));
    // 两个事件都没等到就别把这一轮请求挂死：窗口到底弹没弹出来最终是系统的事。
    const guard = setTimeout(() => finish(null), 1_000);
    guard.unref();
    child.unref();
  });
}

export async function openLocalFolder(folder: string, options: FolderOpenOptions = {}) {
  requireFolder(folder);
  const { command, args } = folderOpenCommand(folder, options.platform);
  await spawnFolderOpener(options.spawnImpl || spawn, command, args);
  return folder;
}

/** 授权目录：入参来自面板那一行，必须仍然在授权清单里，否则一律拒绝。 */
export async function openFilesystemRoot(value: unknown, options: FolderOpenOptions = {}) {
  const raw = String(value ?? '').trim();
  const folder = listFilesystemRoots(options).find((root) => samePath(root, raw));
  if (!folder) throw new Error('只能打开已经授权的文件夹；要打开别的目录，先在上面添加授权。');
  return openLocalFolder(folder, options);
}

/** 运行时安装目录：路径由代码算出（resolveCatalogInstallRoot），面板只能传条目 id。 */
export async function openCatalogFolder(id: unknown, options: FolderOpenOptions = {}) {
  const entry = findCatalogEntry(id);
  if (!entry || !isStdioCatalogEntry(entry)) throw new Error(`未知的本地服务：${String(id || '')}`);
  const folder = resolveCatalogInstallRoot(entry.id, options);
  if (!existsSync(folder)) throw new Error('这个运行时还没安装，装完才有目录。');
  return openLocalFolder(folder, options);
}

/** 自建扩展的落盘目录：scripts/build-playwright-extension.mjs 的产物（不进仓库、也不进发布包）。 */
export function resolveBrowserExtensionFolder(options: { dataDir?: string } = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'browser', 'extension');
}

/**
 * 「打开自建扩展目录」：目录可能还没构建过，这时要给的是一句能照做的事，
 * 而不是「找不到这个文件夹」。打开后用户在浏览器扩展页用「加载已解压的扩展程序」选它。
 */
export async function openBrowserExtensionFolder(options: FolderOpenOptions = {}) {
  const folder = resolveBrowserExtensionFolder(options);
  if (!existsSync(folder)) throw new Error('还没有自建扩展目录：先在项目里运行 npm run build:playwright-extension，再回来点这个按钮。');
  return openLocalFolder(folder, options);
}
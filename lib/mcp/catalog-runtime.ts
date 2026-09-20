/**
 * 目录服务的「安装 / 启动 / 停止 / 状态」。
 *
 * 安装刻意做成一次性的、看得见进度、可以取消的动作（任务书 §35、§36）：
 * 装到项目数据目录里，不写全局 npm 前缀，不动系统环境；失败时把日志尾部原样给用户。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { listMcpServerTools } from './client';
import { MCP_STDIO_IDLE_TIMEOUT_MS, closeStdioServer, stdioServerStatus } from './stdio';
import type { McpProtocolNegotiation } from './protocol';
import {
  catalogBrowserBridge,
  catalogEntryBrowserMode,
  catalogEntryEnabled,
  catalogServerConfig,
  catalogDataDir,
  detectSystemBrowser,
  requireStdioCatalogEntry,
  isCatalogInstalled,
  resolveCatalogInstallRoot,
  setCatalogEntryEnabled,
  type McpCatalogBrowser,
  type McpCatalogBrowserMode,
  type McpStdioCatalogEntry,
} from './catalog';
import type { McpBrowserExtensionBridge } from './browser-extension';

export const MCP_CATALOG_INSTALL_TIMEOUT_MS = 10 * 60_000;
const LOG_TAIL_CHARS = 4000;
const NPM_MIRROR = 'https://registry.npmmirror.com';

export type McpCatalogRuntimeState = 'not_installed' | 'installing' | 'installed' | 'running' | 'error';

export type McpCatalogRuntimeStatus = {
  id: string;
  name: string;
  summary: string;
  version: string;
  installNote: string;
  state: McpCatalogRuntimeState;
  installed: boolean;
  installing: boolean;
  running: boolean;
  pid: number | null;
  enabled: boolean;
  needsBrowser: boolean;
  browser: { channel: McpCatalogBrowser | null; path: string | null };
  /** 浏览器接入方式：内置独立浏览器，或接用户日常浏览器（需要官方扩展）。 */
  browserMode: McpCatalogBrowserMode;
  /** 接日常浏览器时：接的是哪个浏览器、扩展装没装、连接码配没配；其余条目为 null。 */
  browserBridge: McpBrowserExtensionBridge | null;
  installRoot: string;
  logTail: string;
  error: string | null;
  /** 已经授权的目录（Filesystem 用），面板要靠它说明「还差一个文件夹」。 */
  roots: string[];
  /** 进程空闲多久会被回收，面板用它解释「为什么一会儿自己关了」。 */
  idleTimeoutMs: number;
  /** 和这个服务谈成的协议版本：两边不一致时面板标注一句，但不影响使用。 */
  protocol: McpProtocolNegotiation | null;
  /**
   * 正在跑的进程是不是拿旧参数起来的。
   * 启动参数里带着「接哪个浏览器」这类设置，而进程只会按启动那一刻的参数走：
   * 中途换了默认浏览器，面板会显示新浏览器，助手却在操作旧的那个，
   * 用户看到的就是「扩展明明装着，却说没装」。面板据此提示重启。
   */
  argsStale: boolean;
  /** 进程启动时接的浏览器可执行文件；没有或不是扩展模式就是 null。 */
  startedBrowserPath: string | null;
};

type InstallJob = { child: ChildProcess | null; log: string; error: string | null; finished: boolean };

const installs = new Map<string, InstallJob>();

/** 两套启动参数是不是一模一样：用来判断跑着的进程是不是过期的。 */
export function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 从启动参数里取某个开关后面的值（`--executable-path X`）。 */
export function argValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function appendLog(entry: McpStdioCatalogEntry, chunk: string, options: { dataDir?: string }) {
  const job = installs.get(entry.id);
  if (job) job.log = (job.log + chunk).slice(-LOG_TAIL_CHARS);
  try {
    const file = resolveCatalogInstallLogFile(entry.id, options);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, chunk, 'utf8');
  } catch {}
}

export function resolveCatalogInstallLogFile(entryId: string, options: { dataDir?: string } = {}) {
  return path.join(catalogDataDir(options), 'mcp', 'logs', `${entryId}-install.log`);
}

/**
 * 用 Node 自带的 npm CLI 安装，而不是 shell 里敲 `npm install`：
 * 不经过 shell，参数分开传，Windows 上也不会碰上 .cmd 的执行限制。
 */
export function resolveNpmCliPath(nodePath: string = process.execPath) {
  const candidate = path.join(path.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(candidate) ? candidate : null;
}

function looksLikeNetworkFailure(log: string) {
  return /ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|socket hang up|timed out/i.test(log);
}

function npmInstallArgs(entry: McpStdioCatalogEntry, installRoot: string, registry?: string) {
  return [
    'install',
    '--prefix',
    installRoot,
    `${entry.pkg}@${entry.version}`,
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    ...(registry ? ['--registry', registry] : []),
  ];
}

function runNpmInstall(
  entry: McpStdioCatalogEntry,
  options: { dataDir?: string },
  registry?: string,
): Promise<void> {
  const installRoot = resolveCatalogInstallRoot(entry.id, options);
  mkdirSync(installRoot, { recursive: true });
  const npmCli = resolveNpmCliPath();
  if (!npmCli) {
    return Promise.reject(new Error('这台机器上找不到 npm，无法自动安装本地服务'));
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...npmInstallArgs(entry, installRoot, registry)], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: installRoot,
      env: { ...process.env, npm_config_yes: 'true' },
    });
    const job = installs.get(entry.id);
    if (job) job.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => appendLog(entry, chunk, options));
    child.stderr.on('data', (chunk: string) => appendLog(entry, chunk, options));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      reject(new Error('安装超时（10 分钟），请检查网络后重试'));
    }, MCP_CATALOG_INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`安装失败：${error.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && isCatalogInstalled(entry, options)) resolve();
      else reject(new Error(`安装失败（退出码 ${code ?? 'null'}）：${installs.get(entry.id)?.log.trim().slice(-600) || '没有更多信息'}`));
    });
  });
}

/**
 * 安装目录服务。幂等：装好了就直接返回，不会重复下载。
 * 首次失败且看起来是网络问题时，用国内镜像再试一次——项目启动器也是这个策略。
 */
export async function installCatalogServer(id: unknown, options: { dataDir?: string } = {}): Promise<McpCatalogRuntimeStatus> {
  const entry = requireStdioCatalogEntry(id);
  if (isCatalogInstalled(entry, options)) return catalogRuntimeStatus(entry.id, options);
  const current = installs.get(entry.id);
  if (current && !current.finished) throw new Error('这个服务正在安装中，请稍候');
  installs.set(entry.id, { child: null, log: '', error: null, finished: false });
  let failure: Error | null = null;
  try {
    await runNpmInstall(entry, options);
  } catch (error) {
    failure = error instanceof Error ? error : new Error('安装失败');
    const log = installs.get(entry.id)?.log || '';
    if (looksLikeNetworkFailure(log) && !log.includes(NPM_MIRROR)) {
      appendLog(entry, `\n[安装器] 直连 npm 源失败，改用镜像 ${NPM_MIRROR} 重试一次\n`, options);
      try {
        await runNpmInstall(entry, options, NPM_MIRROR);
        failure = null;
      } catch (retryError) {
        failure = retryError instanceof Error ? retryError : failure;
      }
    }
  } finally {
    const job = installs.get(entry.id);
    if (job) {
      job.finished = true;
      job.child = null;
      job.error = failure ? failure.message : null;
    }
  }
  if (failure) throw failure;
  return catalogRuntimeStatus(entry.id, options);
}

/** 取消进行中的安装；已经下完的部分留在目录里，下次安装会接着覆盖。 */
export function cancelCatalogInstall(id: unknown) {
  const entry = requireStdioCatalogEntry(id);
  if (!entry) return false;
  const job = installs.get(entry.id);
  if (!job || job.finished) return false;
  try {
    job.child?.kill();
  } catch {}
  job.finished = true;
  job.error = '安装已取消';
  return true;
}

export function catalogRuntimeStatus(id: unknown, options: { dataDir?: string; roots?: readonly string[] } = {}): McpCatalogRuntimeStatus {
  const entry = requireStdioCatalogEntry(id);
  const job = installs.get(entry.id);
  const installed = isCatalogInstalled(entry, options);
  const enabled = catalogEntryEnabled(entry.id, options);
  const process = stdioServerStatus(entry.id);
  const browser = detectSystemBrowser();
  const browserMode = catalogEntryBrowserMode(entry.id, options);
  const installing = Boolean(job && !job.finished);
  const error = job?.error ?? null;
  // 进程只按启动那一刻的参数走：拿现在的设置再算一遍，就能看出它是不是过期的。
  // 取现在的参数失败（比如手填的浏览器路径刚被删掉）不该让状态整个拿不到，退化成「不过期」。
  let currentArgs: string[] = [];
  try {
    currentArgs = catalogServerConfig(entry, { ...options, enabled, browser, browserMode }).args || [];
  } catch {
    currentArgs = [];
  }
  const state: McpCatalogRuntimeState = installing
    ? 'installing'
    : error && !installed
      ? 'error'
      : process.running
        ? 'running'
        : installed
          ? 'installed'
          : 'not_installed';
  return {
    id: entry.id,
    name: entry.name,
    summary: entry.summary,
    version: entry.version,
    installNote: entry.installNote,
    state,
    installed,
    installing,
    running: process.running,
    pid: process.pid,
    enabled,
    needsBrowser: entry.needsBrowser,
    browser,
    browserMode,
    browserBridge: catalogBrowserBridge(entry, options),
    installRoot: resolveCatalogInstallRoot(entry.id, options),
    logTail: (job?.log || '').slice(-LOG_TAIL_CHARS),
    error,
    roots: [...(options.roots ?? [])],
    idleTimeoutMs: MCP_STDIO_IDLE_TIMEOUT_MS,
    protocol: process.protocol,
    argsStale: process.running && currentArgs.length > 0 && !sameArgs(process.args, currentArgs),
    startedBrowserPath: argValue(process.args, '--executable-path'),
  };
}

/**
 * 打开服务：先落开关，再把进程拉起来并列出工具。
 * 列工具失败不影响开关状态，但会把原因带回去（比如系统里没有可用的浏览器）。
 */
export async function startCatalogServer(id: unknown, options: { dataDir?: string; roots?: readonly string[] } = {}): Promise<McpCatalogRuntimeStatus> {
  const entry = requireStdioCatalogEntry(id);
  if (!isCatalogInstalled(entry, options)) throw new Error('这个服务还没安装完成');
  const browser = detectSystemBrowser();
  const browserMode = catalogEntryBrowserMode(entry.id, options);
  if (browserMode === 'extension') {
    if (!entry.browserExtension) throw new Error(`${entry.name}没有「接日常浏览器」这种用法`);
    const bridge = catalogBrowserBridge(entry, options);
    if (bridge && !bridge.executablePath) {
      throw new Error('没找到能接的浏览器：装一个 Chromium 系浏览器（Chrome、Edge、Brave…），或在面板里手填它的可执行文件路径');
    }
    // 扩展装没装已经有确定结论时先拦下来：否则要等第一次调用白等两分钟才报错。
    if (bridge && bridge.extensionInstalled === false) {
      throw new Error(`在「${bridge.browserName}」里没找到 Playwright Extension（查的是 ${bridge.userDataDir}）：先在它的扩展页装好并启用，或者把浏览器路径改成装了扩展的那个`);
    }
  } else if (entry.needsBrowser && !browser.channel) {
    throw new Error('没有找到可用的浏览器：请先安装 Google Chrome 或 Microsoft Edge，再回来打开这个服务');
  }
  // 没有授权目录时服务会打印用法后直接退出：与其让用户看到一段 stderr，不如在这里说清楚缺什么。
  const roots = [...(options.roots ?? [])];
  if (entry.requiresRoots && !roots.length) {
    throw new Error('这个服务需要至少一个授权文件夹：先在面板里添加要开放的目录，再回来打开');
  }
  setCatalogEntryEnabled(entry.id, true, options);
  const config = catalogServerConfig(entry, { ...options, enabled: true, browser, browserMode, roots });
  try {
    await listMcpServerTools(config, { timeouts: { list: 20_000 } });
  } catch (error) {
    setCatalogEntryEnabled(entry.id, false, options);
    const message = error instanceof Error ? error.message : '启动失败';
    const job = installs.get(entry.id);
    if (job) job.error = message;
    throw new Error(`${entry.name}启动失败：${message}`);
  }
  return catalogRuntimeStatus(entry.id, options);
}

/** 关掉服务：先落开关，再收进程，避免「开关说关了、进程还在跑」。 */
export function stopCatalogServer(id: unknown, options: { dataDir?: string } = {}) {
  const entry = requireStdioCatalogEntry(id);
  setCatalogEntryEnabled(entry.id, false, options);
  closeStdioServer(entry.id);
  return catalogRuntimeStatus(entry.id, options);
}

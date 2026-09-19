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
import {
  catalogEntryEnabled,
  catalogServerConfig,
  catalogDataDir,
  detectSystemBrowser,
  findCatalogEntry,
  isCatalogInstalled,
  resolveCatalogInstallRoot,
  setCatalogEntryEnabled,
  type McpCatalogBrowser,
  type McpCatalogEntry,
} from './catalog';

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
  installRoot: string;
  logTail: string;
  error: string | null;
  /** 进程空闲多久会被回收，面板用它解释「为什么一会儿自己关了」。 */
  idleTimeoutMs: number;
};

type InstallJob = { child: ChildProcess | null; log: string; error: string | null; finished: boolean };

const installs = new Map<string, InstallJob>();

function appendLog(entry: McpCatalogEntry, chunk: string, options: { dataDir?: string }) {
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

function npmInstallArgs(entry: McpCatalogEntry, installRoot: string, registry?: string) {
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
  entry: McpCatalogEntry,
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
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
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
  const entry = findCatalogEntry(id);
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

export function catalogRuntimeStatus(id: unknown, options: { dataDir?: string } = {}): McpCatalogRuntimeStatus {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  const job = installs.get(entry.id);
  const installed = isCatalogInstalled(entry, options);
  const enabled = catalogEntryEnabled(entry.id, options);
  const process = stdioServerStatus(entry.id);
  const browser = detectSystemBrowser();
  const installing = Boolean(job && !job.finished);
  const error = job?.error ?? null;
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
    installRoot: resolveCatalogInstallRoot(entry.id, options),
    logTail: (job?.log || '').slice(-LOG_TAIL_CHARS),
    error,
    idleTimeoutMs: MCP_STDIO_IDLE_TIMEOUT_MS,
  };
}

/**
 * 打开服务：先落开关，再把进程拉起来并列出工具。
 * 列工具失败不影响开关状态，但会把原因带回去（比如系统里没有可用的浏览器）。
 */
export async function startCatalogServer(id: unknown, options: { dataDir?: string } = {}): Promise<McpCatalogRuntimeStatus> {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  if (!isCatalogInstalled(entry, options)) throw new Error('这个服务还没安装完成');
  const browser = detectSystemBrowser();
  if (entry.needsBrowser && !browser.channel) {
    throw new Error('没有找到可用的浏览器：请先安装 Google Chrome 或 Microsoft Edge，再回来打开这个服务');
  }
  setCatalogEntryEnabled(entry.id, true, options);
  const config = catalogServerConfig(entry, { ...options, enabled: true, browser });
  try {
    await listMcpServerTools(config, { timeouts: { list: 20_000 } });
  } catch (error) {
    setCatalogEntryEnabled(entry.id, false, options);
    const message = error instanceof Error ? error.message : '启动失败';
    const job = installs.get(entry.id);
    if (job) job.error = message;
    throw new Error(`浏览器服务启动失败：${message}`);
  }
  return catalogRuntimeStatus(entry.id, options);
}

/** 关掉服务：先落开关，再收进程，避免「开关说关了、进程还在跑」。 */
export function stopCatalogServer(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  setCatalogEntryEnabled(entry.id, false, options);
  closeStdioServer(entry.id);
  return catalogRuntimeStatus(entry.id, options);
}

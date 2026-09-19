/**
 * 本地 MCP 服务目录（curated）。
 *
 * 任务书 §54.4/§54.5：普通用户不能配置任意 executable，也不能有 raw host shell。
 * 所以 stdio 服务只能来自这份代码里写死的清单——用户能决定的只有「装不装、开不开」，
 * 命令、脚本路径、版本、参数全部在代码里。用户自己粘贴的 stdio 配置仍然被拒绝。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import type { McpServerConfig } from './types';

export type McpCatalogBrowser = 'chrome' | 'msedge';

export type McpCatalogArgs = { installRoot: string; dataDir: string; browser: McpCatalogBrowser | null };

export type McpCatalogEntry = {
  id: string;
  name: string;
  summary: string;
  pkg: string;
  /** 固定版本；生产运行不许用 latest（任务书 §54.8）。 */
  version: string;
  /** 首次安装要下载多少，提前告诉用户要等什么。 */
  installNote: string;
  needsBrowser: boolean;
  /**
   * 放行的工具白名单（空数组表示不限制）。
   *
   * 实测 @playwright/mcp 0.0.82 默认会公布 browser_run_code_unsafe：那个工具在服务进程里
   * 跑任意 JS，等于把整台机器交出去，而且它不在 --caps 后面，光靠 flag 关不掉。
   * 白名单同时还有一层好处：上游以后新增工具不会自动出现在我们这边。
   */
  allowedTools: readonly string[];
  /** 组装启动参数（不含 Node 本身）。 */
  args: (context: McpCatalogArgs) => string[];
};

/**
 * 目录里目前只有一个服务。启动参数是对着 @playwright/mcp 自己的 `--help` 写的，
 * 升级版本时必须重新核对这些 flag，不要凭印象改。
 */
export const MCP_CATALOG_ENTRIES: readonly McpCatalogEntry[] = [
  {
    id: 'playwright',
    name: '浏览器控制',
    summary: '让助手打开网页、点击、填表、下载，用你电脑上已有的浏览器（Microsoft Playwright MCP）。',
    pkg: '@playwright/mcp',
    version: '0.0.82',
    installNote: '约 60 MB，只装一次，装在项目数据目录里，不动系统环境',
    needsBrowser: true,
    allowedTools: [
      'browser_click',
      'browser_close',
      'browser_console_messages',
      'browser_drag',
      'browser_drop',
      'browser_emulate_media',
      'browser_evaluate',
      'browser_file_upload',
      'browser_fill_form',
      'browser_find',
      'browser_handle_dialog',
      'browser_hover',
      'browser_navigate',
      'browser_navigate_back',
      'browser_network_request',
      'browser_network_requests',
      'browser_press_key',
      'browser_resize',
      'browser_select_option',
      'browser_snapshot',
      'browser_tabs',
      'browser_take_screenshot',
      'browser_type',
      'browser_wait_for',
    ],
    args: ({ installRoot, dataDir, browser }) => [
      path.join(installRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'),
      ...(browser ? ['--browser', browser] : []),
      // 独立 profile：不复用用户日常浏览器的登录态，也避免和用户自己开的窗口打架。
      '--user-data-dir',
      path.join(dataDir, 'browser', 'profiles', 'default'),
      // 自动命名的截图等产物落到受控目录，不散在工作区里。
      '--output-dir',
      path.join(dataDir, 'browser', 'downloads'),
      // 不传 --caps：vision / pdf / devtools（含 run-code）这类高权限能力第一版一律不开。
    ],
  },
];

export function findCatalogEntry(id: unknown): McpCatalogEntry | null {
  const target = String(id || '').trim();
  return MCP_CATALOG_ENTRIES.find((entry) => entry.id === target) || null;
}

export function catalogDataDir(options: { dataDir?: string } = {}) {
  return options.dataDir || resolveLocalDataDir();
}

export function resolveCatalogInstallRoot(entryId: string, options: { dataDir?: string } = {}) {
  return path.join(catalogDataDir(options), 'mcp', entryId);
}

/** 浏览器进程的工作目录：MCP 只允许它碰这里（默认就是 cwd）。 */
export function resolveCatalogWorkspace(entryId: string, options: { dataDir?: string } = {}) {
  return path.join(catalogDataDir(options), 'browser', 'workspace', entryId);
}

export function catalogEntryBinPath(entry: McpCatalogEntry, options: { dataDir?: string } = {}) {
  return path.join(resolveCatalogInstallRoot(entry.id, options), 'node_modules', entry.pkg.replace('/', path.sep), 'cli.js');
}

export function isCatalogInstalled(entry: McpCatalogEntry, options: { dataDir?: string } = {}) {
  return existsSync(catalogEntryBinPath(entry, options));
}

const BROWSER_CANDIDATES: Record<string, Record<McpCatalogBrowser, string[]>> = {
  win32: {
    chrome: [
      '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
      '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
    ],
    msedge: [
      '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
      '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  darwin: {
    chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    msedge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  },
  linux: {
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    msedge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
  },
};

function expandWindowsEnv(template: string, env: NodeJS.ProcessEnv) {
  return template.replace(/%([^%]+)%/g, (_match, name: string) => env[name] || env[name.toUpperCase()] || '');
}

/**
 * 找用户机器上已有的浏览器。默认 headed + 系统浏览器，避免为了一个 MCP 再下一份 Chromium。
 * Chrome 优先：兼容性最好，Edge 作为兜底。
 */
export function detectSystemBrowser(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { channel: McpCatalogBrowser | null; path: string | null } {
  const candidates = BROWSER_CANDIDATES[platform];
  if (!candidates) return { channel: null, path: null };
  for (const channel of ['chrome', 'msedge'] as const) {
    for (const template of candidates[channel]) {
      const file = platform === 'win32' ? expandWindowsEnv(template, env) : template;
      if (file && existsSync(file)) return { channel, path: file };
    }
  }
  return { channel: null, path: null };
}

export type McpCatalogState = Record<string, { enabled?: boolean; updatedAt?: number }>;

export function resolveCatalogStateFile(options: { dataDir?: string } = {}) {
  return path.join(catalogDataDir(options), 'mcp', 'catalog.json');
}

/** 目录服务的开关和用户自己配的服务分开存：混在一起会让「谁写的配置」变得说不清。 */
export function readCatalogState(options: { dataDir?: string } = {}): McpCatalogState {
  const file = resolveCatalogStateFile(options);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as McpCatalogState) : {};
  } catch {
    return {};
  }
}

export function catalogEntryEnabled(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return false;
  return readCatalogState(options)[entry.id]?.enabled === true;
}

export function setCatalogEntryEnabled(id: unknown, enabled: boolean, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  const file = resolveCatalogStateFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  const state = readCatalogState(options);
  state[entry.id] = { enabled, updatedAt: Date.now() };
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return state[entry.id];
}

/**
 * 组装目录服务的运行时配置。命令永远是 Node 自己（process.execPath），
 * 脚本路径来自安装目录，用户无法影响其中任何一段。
 */
export function catalogServerConfig(
  entry: McpCatalogEntry,
  options: { dataDir?: string; enabled?: boolean; browser?: { channel: McpCatalogBrowser | null } } = {},
): McpServerConfig {
  const dataDir = catalogDataDir(options);
  const installRoot = resolveCatalogInstallRoot(entry.id, options);
  const workspace = resolveCatalogWorkspace(entry.id, options);
  try {
    mkdirSync(workspace, { recursive: true });
  } catch {}
  const browser = options.browser ?? detectSystemBrowser();
  return {
    id: entry.id,
    name: entry.name,
    url: `stdio://${entry.id}`,
    transport: 'stdio',
    enabled: options.enabled ?? catalogEntryEnabled(entry.id, options),
    // 浏览器工具几乎都有副作用（点击、提交），不开写入等于装了个摆设；真正的把关放在审批链路。
    allowWrite: true,
    catalogId: entry.id,
    command: process.execPath,
    args: entry.args({ installRoot, dataDir, browser: browser.channel }),
    enabledTools: [...entry.allowedTools],
    cwd: workspace,
  };
}

/** 启用且装好的目录服务；没装好的不出现，避免面板里摆一个点不动的入口。 */
export function listCatalogServers(options: { dataDir?: string } = {}): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  for (const entry of MCP_CATALOG_ENTRIES) {
    if (!catalogEntryEnabled(entry.id, options)) continue;
    if (!isCatalogInstalled(entry, options)) continue;
    servers.push(catalogServerConfig(entry, { ...options, enabled: true }));
  }
  return servers;
}

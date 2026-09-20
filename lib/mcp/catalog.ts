/**
 * 本地 MCP 服务目录（curated）。
 *
 * 任务书 §54.4/§54.5：普通用户不能配置任意 executable，也不能有 raw host shell。
 * 所以 stdio 服务只能来自这份代码里写死的清单——用户能决定的只有「装不装、开不开」，
 * 命令、脚本路径、版本、参数全部在代码里。用户自己粘贴的 stdio 配置仍然被拒绝。
 *
 * 目录 v1 有四条，按「用户会怎么看」排序：
 * - playwright  浏览器控制（stdio，按需 npm 安装）
 * - filesystem  本地文件（stdio，按需 npm 安装 + 用户授权目录）
 * - github      GitHub（远端 Streamable HTTP + PAT）
 * - context7    开发文档（远端 Streamable HTTP，可匿名）
 *
 * 远端条目不下载任何东西：面板上的「连接」只是把一份带凭据的服务配置写进
 * `.data/mcp/servers.json`，之后和用户自己配的服务走完全同一条链路（探测、白名单、
 * 按需下发、审批）。这样做的代价是凭据会落在那个文件里（0600），好处是不必再写一套
 * 只对官方条目生效的连接管理。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { listFilesystemRoots } from './filesystem-roots';
import {
  PLAYWRIGHT_EXTENSION_TOKEN_ENV,
  browserNameFromPath,
  detectDefaultBrowserExecutable,
  extensionInstalledForBrowser,
  resolveUserDataDir,
  type McpBrowserExecutable,
  type McpBrowserExtensionBridge,
} from './browser-extension';
import type { ToolPermissions } from '@/lib/tools/registry';
import type { McpServerConfig } from './types';

export type McpCatalogBrowser = 'chrome' | 'msedge';

/**
 * 浏览器接入方式：
 * - managed   内置独立浏览器：我们拉起一个独立 profile 的浏览器，零安装、可随包发布。
 * - extension 接日常浏览器：连用户自己开着的 Chrome/Edge（需要官方 Playwright Extension），
 *             因此登录态、Cookie、正在看的标签页都是他熟悉的那一份。
 */
export type McpCatalogBrowserMode = 'managed' | 'extension';

/** stdio：本机子进程；http：远端 Streamable HTTP。 */
export type McpCatalogTransport = 'stdio' | 'http';

export type McpCatalogInstallMode = 'optional-npm' | 'remote';

/** 维护方等级：official 是厂商官方项目，curated 是我们挑过、但不是厂商自营。 */
export type McpCatalogTrust = 'trusted-official' | 'trusted-curated';

/**
 * 远端条目的凭据写法：只描述「往哪个请求头写什么」。
 * 值本身永远不写进代码，也不回传前端（见 lib/mcp/store.ts 的脱敏）。
 */
export type McpCatalogAuth = {
  kind: 'none' | 'token';
  headerName?: string;
  headerPrefix?: string;
  /** 面板上的字段名，例如「GitHub Personal Access Token」。 */
  label?: string;
  /** 去哪儿申请，面板给一个可点的链接。 */
  helpUrl?: string;
  /** 允许不带凭据连接（例如 Context7 基础模式）。 */
  optional?: boolean;
  note?: string;
};

export type McpCatalogSetup = {
  requiresAuth: boolean;
  requiresLocalRuntime: boolean;
  supportsOAuth?: boolean;
};

export type McpCatalogToolSelection = {
  /** allowlist：只放行下面列的工具；dynamic：由服务自己公布，按只读/白名单规则收敛。 */
  mode: 'allowlist' | 'dynamic';
  defaultToolsets?: readonly string[];
  defaultTools?: readonly string[];
  /** 连上之后默认「按需下发」：只有这一轮提到它才把它的工具交给模型。 */
  lazy?: boolean;
};

/**
 * 远端连接的「可选项」：能力组（GitHub 的 toolsets）与写操作分项。
 *
 * - toolset 是能力面：关掉的组会从 `x-mcp-toolsets` 请求头里去掉，服务端直接不公布那批工具。
 *   本机不按工具名猜分组——上游换个版本名就可能误伤只读工具，分组交给服务端执行更稳。
 * - writeGate 是写操作分项（任务书 §22）：服务没标成只读的工具，只有命中已打开的项才放行；
 *   命中不了任何一项的写工具按「没授权」处理，上游以后新增写工具也不会自动放行。
 */
export type McpCatalogWriteGate = {
  id: string;
  label: string;
  /** 精确工具名，或带 `*` 的通配模式（例如 `*_secret`）。只对写工具生效。 */
  match: readonly string[];
};

export type McpCatalogToolset = {
  id: string;
  label: string;
  summary?: string;
  writes?: readonly McpCatalogWriteGate[];
};
export type McpCatalogEntry = {
  id: string;
  name: string;
  summary: string;
  publisher: string;
  homepage: string;
  transport: McpCatalogTransport;
  installMode: McpCatalogInstallMode;
  trust: McpCatalogTrust;
  /** 界面上的一句话能力摘要。 */
  capabilities: readonly string[];
  /** 这个连接器会碰到什么，用于面板展示与审计。 */
  permissions: readonly ToolPermissions[];
  /** stdio：放行的工具白名单（空数组表示不限制）。 */
  allowedTools: readonly string[];
  /** 默认只读：写工具要用户显式打开。 */
  defaultReadOnly: boolean;
  defaultEnabled: boolean;
  setup: McpCatalogSetup;
  toolSelection: McpCatalogToolSelection;
  /** stdio 专用：npm 包名与固定版本。 */
  pkg?: string;
  version?: string;
  installNote?: string;
  needsBrowser?: boolean;
  /**
   * 需要用户自己装扩展的浏览器条目：商店地址与说明写在这里，面板照着渲染引导，
   * 免得「去哪儿装」这种事散落在组件文案里。
   */
  browserExtension?: { storeName: string; storeUrl: string; storeId: string; note: string };
  /** stdio 专用：必须至少有一个用户授权目录才能启动（Filesystem 就是这种）。 */
  requiresRoots?: boolean;
  /** stdio 专用：组装启动参数（不含 Node 本身）。 */
  args?: (context: McpCatalogArgs) => string[];
  /** http 专用：远端地址。 */
  url?: string;
  auth?: McpCatalogAuth;
  /** 远端专用：可选的能力组（GitHub 的 toolsets），关掉的组连请求头一起收掉。 */
  toolsets?: readonly McpCatalogToolset[];
  /** 远端专用：任何开关都打不开的操作（任务书 §22），命中的写工具一律拒绝。 */
  forbiddenTools?: readonly string[];
};

/** stdio 条目：字段收窄，调用方不用再判空。 */
export type McpStdioCatalogEntry = McpCatalogEntry & {
  transport: 'stdio';
  pkg: string;
  version: string;
  installNote: string;
  needsBrowser: boolean;
  allowedTools: readonly string[];
  args: (context: McpCatalogArgs) => string[];
};

export type McpRemoteCatalogEntry = McpCatalogEntry & {
  transport: 'http';
  url: string;
};

export type McpCatalogArgs = {
  installRoot: string;
  dataDir: string;
  browser: McpCatalogBrowser | null;
  /** 浏览器接入方式（目前只有 Playwright 用得上）。 */
  browserMode: McpCatalogBrowserMode;
  /** 「接日常浏览器」要接的那个可执行文件；null 表示没找到，退回 Playwright 自己的默认行为。 */
  browserExecutable?: string | null;
  /** 浏览器站点名单：只有填了才传给服务端，空数组等于不限制。 */
  allowedOrigins?: readonly string[];
  blockedOrigins?: readonly string[];
  /** 用户授权的目录（Filesystem 专用），已经过 lib/mcp/filesystem-roots.ts 归一化。 */
  roots: readonly string[];
};

/**
 * Playwright 的工具白名单。
 *
 * 实测 @playwright/mcp 0.0.82 默认会公布 browser_run_code_unsafe：那个工具在服务进程里
 * 跑任意 JS，等于把整台机器交出去，而且它不在 --caps 后面，光靠 flag 关不掉。
 * 白名单同时还有一层好处：上游以后新增工具不会自动出现在我们这边。
 */
const PLAYWRIGHT_TOOLS: readonly string[] = [
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
];

/**
 * Filesystem 的工具白名单。名字来自 @modelcontextprotocol/server-filesystem@2026.8.31
 * 注册的工具（实测枚举，升级版本时要重新核对）。
 * 写工具（write_file / edit_file / create_directory / move_file）留在这里，
 * 但服务默认只读：没打开「允许写入」时它们不会下发给模型。
 */
const FILESYSTEM_TOOLS: readonly string[] = [
  'read_file',
  'read_text_file',
  'read_media_file',
  'read_multiple_files',
  'write_file',
  'edit_file',
  'create_directory',
  'list_directory',
  'list_directory_with_sizes',
  'directory_tree',
  'move_file',
  'search_files',
  'get_file_info',
  'list_allowed_directories',
];

/**
 * Context7 公布的两个工具（实测 tools/list）：resolve-library-id / query-docs。
 * 白名单写死，服务以后新增工具也不会自动挂给模型。
 */
const CONTEXT7_TOOLS: readonly string[] = ['resolve-library-id', 'query-docs'];
/**
 * GitHub 官方远端服务公布的工具组（docs/remote-server.md 的 `x-mcp-toolsets`）。
 * v1 只放这五组：默认四组，Actions 要用户自己打开（任务书 §20/§31，不开 all）。
 */
const GITHUB_TOOLSETS: readonly McpCatalogToolset[] = [
  { id: 'context', label: '账号与团队', summary: '当前登录账号、所属组织与团队' },
  {
    id: 'repos',
    label: '仓库与文件',
    summary: '读代码、搜索、看提交与分支',
    writes: [
      { id: 'repos:files', label: '修改仓库文件', match: ['create_or_update_file', 'delete_file', 'push_files', 'create_branch', 'update_pull_request_branch'] },
      { id: 'repos:create', label: '创建 / 复制仓库', match: ['create_repository', 'fork_repository'] },
    ],
  },
  {
    id: 'issues',
    label: 'Issue',
    summary: '查 Issue、标签与子任务',
    writes: [
      { id: 'issues:create', label: '创建 / 修改 Issue', match: ['create_issue', 'update_issue', 'issue_write', 'add_sub_issue', 'sub_issue_write', 'remove_sub_issue'] },
      { id: 'issues:comment', label: '发评论 / 提交评审', match: ['add_issue_comment', 'add_reply_to_pull_request_comment', 'add_comment_to_pending_review', 'pull_request_review_write'] },
    ],
  },
  {
    id: 'pull_requests',
    label: 'Pull Request',
    summary: '查 PR、diff、评审与状态',
    writes: [
      { id: 'pulls:create', label: '创建 / 修改 PR', match: ['create_pull_request', 'update_pull_request'] },
      { id: 'pulls:merge', label: 'Merge PR', match: ['merge_pull_request'] },
    ],
  },
  {
    id: 'actions',
    label: 'Actions（可选）',
    summary: '看构建日志；触发或取消工作流算写操作',
    writes: [{ id: 'actions:run', label: '触发 / 取消工作流', match: ['actions_run_trigger', 'run_workflow', 'rerun_workflow_run', 'rerun_failed_jobs', 'cancel_workflow_run', 'delete_workflow_run_logs'] }],
  },
];

/**
 * Catalog v1 明确不开放的操作（任务书 §22）：任何开关都打不开。
 * 只对写工具生效（只读的告警查询工具名字里也带 secret / branch_protection，不能误伤）。
 */
const GITHUB_FORBIDDEN_TOOLS: readonly string[] = [
  'delete_repository',
  '*branch_protection*',
  'force_push*',
  'create_or_update_*secret*',
  'set_*secret*',
  'delete_*secret*',
];

/**
 * 目录里的条目。启动参数是对着各自的 `--help` / 官方文档写的，
 * 升级版本时必须重新核对这些 flag，不要凭印象改。
 */
export const MCP_CATALOG_ENTRIES: readonly McpCatalogEntry[] = [
  {
    id: 'playwright',
    name: '浏览器控制',
    summary: '让助手打开网页、点击、填表、下载，用你电脑上已有的浏览器（Microsoft Playwright MCP）。',
    publisher: 'Microsoft',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    transport: 'stdio',
    installMode: 'optional-npm',
    trust: 'trusted-official',
    capabilities: ['打开网页', '读取页面', '点击与填表', '截图', '下载文件'],
    permissions: ['network', 'external:write', 'artifact:write'],
    defaultReadOnly: false,
    defaultEnabled: false,
    setup: { requiresAuth: false, requiresLocalRuntime: true },
    toolSelection: { mode: 'allowlist', lazy: true },
    pkg: '@playwright/mcp',
    version: '0.0.82',
    installNote: '约 60 MB，只装一次，装在项目数据目录里，不动系统环境',
    needsBrowser: true,
    browserExtension: {
      storeName: 'Playwright Extension',
      storeUrl: 'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm',
      storeId: 'mmlmfjhmonkocbjadbfplnigmagldckm',
      note: '扩展由微软官方发布（Apache-2.0，源码在 microsoft/playwright 的 packages/extension）。它需要「调试器」和「访问所有网站」两项权限，只在本机与助手通信，数据不出这台电脑。',
    },
    allowedTools: PLAYWRIGHT_TOOLS,
    args: ({ installRoot, dataDir, browser, browserMode, browserExecutable, allowedOrigins, blockedOrigins }) => {
      const cli = path.join(installRoot, 'node_modules', '@playwright', 'mcp', 'cli.js');
      // 自动命名的截图等产物落到受控目录，不散在工作区里；两种模式都要。
      const output = ['--output-dir', path.join(dataDir, 'browser', 'downloads')];
      // 站点名单：用户填了才传，空着等于不限制（默认行为不变）。服务端按分号分隔解析。
      const origins = [
        ...(allowedOrigins?.length ? ['--allowed-origins', allowedOrigins.join(';')] : []),
        ...(blockedOrigins?.length ? ['--blocked-origins', blockedOrigins.join(';')] : []),
      ];
      if (browserMode === 'extension') {
        // --extension 会忽略 --browser（实测 0.0.82 的 --help）：接的是用户自己开着的浏览器，
        // 不是我们拉起来的那个，所以这里不能再传 --browser / --user-data-dir。
        // --executable-path 是关键：不传时 Playwright 只去 Chrome/Edge 的默认 profile 里找扩展，
        // 用户把扩展装在别的 Chromium（Tabbit、Brave…）里，就会得到一句「未检测到扩展」。
        return [
          cli,
          '--extension',
          ...(browserExecutable ? ['--executable-path', browserExecutable] : []),
          ...output,
          ...origins,
        ];
      }
      return [
        cli,
        ...(browser ? ['--browser', browser] : []),
        // 独立 profile：不复用用户日常浏览器的登录态，也避免和用户自己开的窗口打架。
        '--user-data-dir',
        path.join(dataDir, 'browser', 'profiles', 'default'),
        ...output,
        ...origins,
        // 不传 --caps：vision / pdf / devtools（含 run-code）这类高权限能力第一版一律不开。
      ];
    },
  },
  {
    id: 'filesystem',
    name: '本地文件',
    summary: '让助手读你指定的文件夹（默认只读），写入要你单独打开（MCP Filesystem）。',
    publisher: 'Model Context Protocol',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    transport: 'stdio',
    installMode: 'optional-npm',
    trust: 'trusted-official',
    capabilities: ['读取文件', '搜索文件', '查看目录结构', '写入与移动（需单独授权）'],
    permissions: ['fs:read', 'fs:write'],
    defaultReadOnly: true,
    defaultEnabled: false,
    setup: { requiresAuth: false, requiresLocalRuntime: true },
    toolSelection: { mode: 'allowlist', lazy: true },
    pkg: '@modelcontextprotocol/server-filesystem',
    version: '2026.8.31',
    installNote: '约 5 MB，只装一次，装在项目数据目录里，不动系统环境',
    needsBrowser: false,
    requiresRoots: true,
    allowedTools: FILESYSTEM_TOOLS,
    // 授权目录只能作为启动参数给它；SANMAO 侧还会对每次调用的 path 再做一遍校验
    // （见 lib/mcp/filesystem-policy.ts）：只靠服务端自己的根目录限制不够。
    args: ({ installRoot, roots }) => [
      path.join(installRoot, 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js'),
      ...roots,
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    summary: '查仓库、Issue、PR 和 Actions。默认只读，写操作要逐项打开并逐次确认。',
    publisher: 'GitHub',
    homepage: 'https://github.com/github/github-mcp-server',
    transport: 'http',
    installMode: 'remote',
    trust: 'trusted-official',
    capabilities: ['仓库与文件', 'Issue', 'Pull Request', 'Actions'],
    permissions: ['network', 'external:write'],
    allowedTools: [],
    defaultReadOnly: true,
    defaultEnabled: false,
    setup: { requiresAuth: true, requiresLocalRuntime: false },
    toolSelection: { mode: 'dynamic', defaultToolsets: ['context', 'repos', 'issues', 'pull_requests'], lazy: true },
    toolsets: GITHUB_TOOLSETS,
    forbiddenTools: GITHUB_FORBIDDEN_TOOLS,
    url: 'https://api.githubcopilot.com/mcp/',
    auth: {
      kind: 'token',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
      label: 'GitHub 令牌（PAT）',
      helpUrl: 'https://github.com/settings/tokens',
      note: '建议用 fine-grained token：Repository access 只选要用的仓库，权限只给 Contents / Issues / Pull requests 的 Read（只读模式够用）。令牌只保存本机，页面上不会再显示明文。',
    },
  },
  {
    id: 'context7',
    name: '开发文档',
    summary: '查库和 API 的最新官方文档（Context7）。基础模式可匿名使用，填 Key 额度更高。',
    publisher: 'Upstash',
    homepage: 'https://github.com/upstash/context7',
    transport: 'http',
    installMode: 'remote',
    trust: 'trusted-curated',
    capabilities: ['库文档', 'API 用法', '版本差异'],
    permissions: ['network'],
    allowedTools: CONTEXT7_TOOLS,
    defaultReadOnly: true,
    defaultEnabled: false,
    setup: { requiresAuth: false, requiresLocalRuntime: false, supportsOAuth: false },
    toolSelection: { mode: 'allowlist', lazy: true },
    url: 'https://mcp.context7.com/mcp',
    auth: {
      kind: 'token',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
      label: 'Context7 API Key',
      helpUrl: 'https://context7.com/dashboard',
      optional: true,
      note: '不填 Key 也能用（匿名额度较低）。',
    },
  },
];

export function isStdioCatalogEntry(entry: McpCatalogEntry | null | undefined): entry is McpStdioCatalogEntry {
  return entry?.transport === 'stdio';
}

export function isRemoteCatalogEntry(entry: McpCatalogEntry | null | undefined): entry is McpRemoteCatalogEntry {
  return entry?.transport === 'http';
}

export function stdioCatalogEntries(): McpStdioCatalogEntry[] {
  return MCP_CATALOG_ENTRIES.filter(isStdioCatalogEntry);
}

export function remoteCatalogEntries(): McpRemoteCatalogEntry[] {
  return MCP_CATALOG_ENTRIES.filter(isRemoteCatalogEntry);
}

export function findCatalogEntry(id: unknown): McpCatalogEntry | null {
  const target = String(id || '').trim();
  return MCP_CATALOG_ENTRIES.find((entry) => entry.id === target) || null;
}

/**
 * stdio 专用入口：远端条目在这里被明确拒绝，而不是当成「未知的本地服务」——
 * 面板点错了要给一句能看懂的话。
 */
export function requireStdioCatalogEntry(id: unknown): McpStdioCatalogEntry {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  if (!isStdioCatalogEntry(entry)) throw new Error(`${entry.name} 是远端连接器，不需要在本机安装，直接在面板里连接即可。`);
  return entry;
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

export function catalogEntryBinPath(entry: McpStdioCatalogEntry, options: { dataDir?: string } = {}) {
  return path.join(resolveCatalogInstallRoot(entry.id, options), 'node_modules', entry.pkg.replace('/', path.sep), 'cli.js');
}

/**
 * 装好了没有：npm 包（如 @playwright/mcp）在包根放 cli.js，其余按 dist/index.js 找，
 * 两者都没有就当没装好——不能只看目录存在，半截安装会让服务起不来。
 */
export function isCatalogInstalled(entry: McpStdioCatalogEntry, options: { dataDir?: string } = {}) {
  const packageRoot = path.join(resolveCatalogInstallRoot(entry.id, options), 'node_modules', entry.pkg.replace('/', path.sep));
  if (!existsSync(packageRoot)) return false;
  if (existsSync(catalogEntryBinPath(entry, options))) return true;
  return existsSync(path.join(packageRoot, 'dist', 'index.js'));
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

/**
 * 目录条目的状态：开关、写入授权、最后一次失败原因。
 *
 * 和用户自己配的服务分开存：混在一起会让「谁写的配置」变得说不清。
 * lastError / authRequired 只用于面板显示（例如 GitHub 的 token 过期要说「需要重新连接」，
 * 而不是丢一个裸的 401 出来）。
 */
export type McpCatalogStateEntry = {
  enabled?: boolean;
  /** 写权限：Filesystem 用它放开写工具；GitHub 还额外受 writeGates 逐项限制。 */
  allowWrite?: boolean;
  /** 浏览器接入方式：没存过按 managed（内置独立浏览器）走，升级上来的用户行为不变。 */
  browserMode?: McpCatalogBrowserMode;
  /** 手填的浏览器可执行文件（接日常浏览器用）；不填就自动认系统默认浏览器。 */
  browserExecutablePath?: string;
  /** 扩展的免点击连接码：填了之后连接页不再要人点确认。值只留在服务端，不回传前端。 */
  extensionToken?: string;
  /** 浏览器站点名单：要传 --allowed-origins / --blocked-origins 的项；空数组等于不限制。 */
  allowedOrigins?: string[];
  blockedOrigins?: string[];
  /** 远端条目的能力组（GitHub toolsets）：没存过就用条目默认值。 */
  toolsets?: string[];
  /** 远端条目的写权限分项：默认一项都不开，用户逐项打开。 */
  writeGates?: string[];
  /** 连上之后问到的账号名（只用于面板显示「连的是谁」）。 */
  account?: string;
  updatedAt?: number;
  lastError?: string;
  lastErrorAt?: number;
  authRequired?: boolean;
};

export type McpCatalogState = Record<string, McpCatalogStateEntry>;

export function resolveCatalogStateFile(options: { dataDir?: string } = {}) {
  return path.join(catalogDataDir(options), 'mcp', 'catalog.json');
}

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

function writeCatalogState(state: McpCatalogState, options: { dataDir?: string } = {}) {
  const file = resolveCatalogStateFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** 改一个条目的状态；patch 里的 undefined 表示不动这一项。 */
function patchCatalogState(id: unknown, patch: Partial<McpCatalogStateEntry>, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知的本地服务：${String(id || '')}`);
  const state = readCatalogState(options);
  const next: McpCatalogStateEntry = { ...state[entry.id], ...patch, updatedAt: Date.now() };
  for (const key of Object.keys(next) as (keyof McpCatalogStateEntry)[]) {
    if (next[key] === undefined) delete next[key];
  }
  state[entry.id] = next;
  writeCatalogState(state, options);
  return next;
}

export function catalogEntryEnabled(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return false;
  return readCatalogState(options)[entry.id]?.enabled === true;
}

export function setCatalogEntryEnabled(id: unknown, enabled: boolean, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { enabled }, options);
}

/** 写权限：没设置过时返回条目的默认值（defaultReadOnly 的反面）。 */
export function catalogEntryAllowWrite(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return false;
  const saved = readCatalogState(options)[entry.id]?.allowWrite;
  return typeof saved === 'boolean' ? saved : !entry.defaultReadOnly;
}

export function setCatalogEntryAllowWrite(id: unknown, allowWrite: boolean, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { allowWrite }, options);
}

/** 浏览器接入方式：Playwright 默认接入用户的系统默认浏览器；明确选择 managed 后才使用独立浏览器。 */
export function catalogEntryBrowserMode(id: unknown, options: { dataDir?: string } = {}): McpCatalogBrowserMode {
  const entry = findCatalogEntry(id);
  if (!entry) return 'managed';
  const saved = readCatalogState(options)[entry.id]?.browserMode;
  if (saved === 'managed' || saved === 'extension') return saved;
  return entry.id === 'playwright' ? 'extension' : 'managed';
}

export function setCatalogEntryBrowserMode(id: unknown, browserMode: McpCatalogBrowserMode, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { browserMode }, options);
}

/** 连接码长度上限：扩展页给的是一串 43 字符的 base64url，再长就不是它了。 */
export const MCP_CATALOG_MAX_EXTENSION_TOKEN_CHARS = 200;

/**
 * 手填的浏览器可执行文件。只收绝对路径、且必须真的在；
 * 文件不在了就当作没设过，免得面板一直拿一个已经不存在的路径去启动。
 */
export function normalizeCatalogBrowserExecutablePath(value: unknown): string {
  const file = String(value ?? '').trim().replace(/^"|"$/g, '');
  if (!file) return '';
  if (!path.isAbsolute(file)) throw new Error(`浏览器路径要写完整路径，收到的是「${file}」`);
  if (!existsSync(file)) throw new Error(`这个路径上没有文件：${file}`);
  return file;
}

export function catalogEntryBrowserExecutablePath(id: unknown, options: { dataDir?: string } = {}): string {
  const entry = findCatalogEntry(id);
  if (!entry) return '';
  const saved = readCatalogState(options)[entry.id]?.browserExecutablePath;
  if (typeof saved !== 'string' || !saved.trim()) return '';
  return existsSync(saved) ? saved : '';
}

export function setCatalogEntryBrowserExecutablePath(id: unknown, value: unknown, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { browserExecutablePath: normalizeCatalogBrowserExecutablePath(value) || undefined }, options);
}

/**
 * 扩展的免点击连接码。留空 = 清除。
 * 扩展页会把整行 `PLAYWRIGHT_MCP_EXTENSION_TOKEN=xxx` 提供出来，用户多半整行复制，所以这里也认整行。
 */
export function normalizeCatalogExtensionToken(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const inline = new RegExp(`${PLAYWRIGHT_EXTENSION_TOKEN_ENV}\\s*=\\s*(\\S+)`).exec(text);
  const token = inline ? inline[1] : text;
  if (token.length > MCP_CATALOG_MAX_EXTENSION_TOKEN_CHARS) throw new Error('连接码太长了，看着不像扩展页上那一串');
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) throw new Error('连接码只由字母、数字、-、_ 组成：请到扩展页复制完整的一串');
  return token;
}

export function catalogEntryExtensionToken(id: unknown, options: { dataDir?: string } = {}): string {
  const entry = findCatalogEntry(id);
  if (!entry) return '';
  const saved = readCatalogState(options)[entry.id]?.extensionToken;
  return typeof saved === 'string' ? saved : '';
}

export function setCatalogEntryExtensionToken(id: unknown, value: unknown, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { extensionToken: normalizeCatalogExtensionToken(value) || undefined }, options);
}

/** 读一次浏览器 profile 目录要解析几百 KB 的偏好文件：面板会轮询，结果缓存一分钟。 */
const extensionCheckCache = new Map<string, { at: number; installed: boolean | null }>();
const EXTENSION_CHECK_TTL_MS = 60_000;

function cachedExtensionInstalled(executablePath: string | null): boolean | null {
  if (!executablePath) return null;
  const hit = extensionCheckCache.get(executablePath);
  if (hit && Date.now() - hit.at < EXTENSION_CHECK_TTL_MS) return hit.installed;
  const installed = extensionInstalledForBrowser(executablePath);
  extensionCheckCache.set(executablePath, { at: Date.now(), installed });
  return installed;
}

/**
 * 「接日常浏览器」要接哪个浏览器：用户手填的优先，其次系统默认浏览器，
 * 最后才退回 Chrome/Edge 候选。managed 模式不用它（那里只认 --browser 的 chrome/msedge）。
 */
export function resolveCatalogBrowserExecutable(
  entry: McpCatalogEntry,
  options: { dataDir?: string } = {},
): McpBrowserExecutable {
  const override = catalogEntryBrowserExecutablePath(entry.id, options);
  if (override) return { path: override, name: browserNameFromPath(override), source: 'override' };
  const preferred = detectDefaultBrowserExecutable();
  if (preferred) return { path: preferred, name: browserNameFromPath(preferred), source: 'default' };
  const fallback = detectSystemBrowser();
  if (fallback.path) return { path: fallback.path, name: browserNameFromPath(fallback.path), source: 'candidate' };
  return { path: null, name: '', source: 'none' };
}

/** 面板要显示的「接的是哪个浏览器、扩展装没装、连接码配没配」；非浏览器条目返回 null。 */
export function catalogBrowserBridge(
  entry: McpCatalogEntry,
  options: { dataDir?: string } = {},
): McpBrowserExtensionBridge | null {
  if (!entry.browserExtension) return null;
  const browser = resolveCatalogBrowserExecutable(entry, options);
  return {
    browserName: browser.name,
    executablePath: browser.path,
    source: browser.source,
    userDataDir: resolveUserDataDir(browser.path),
    extensionInstalled: cachedExtensionInstalled(browser.path),
    tokenConfigured: Boolean(catalogEntryExtensionToken(entry.id, options)),
  };
}

/** 站点名单条数上限：再多就不是「限制几个站点」，而是抄一份导航站清单了。 */
export const MCP_CATALOG_MAX_ORIGINS = 50;

/**
 * 归一化站点名单：接受数组，也接受面板里直接粘的一整段（换行 / 逗号 / 分号分隔）。
 * 填错一项就整次拒绝并说清是哪一项——静默丢掉一条会让人以为限制生效了。
 */
export function normalizeCatalogOrigins(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\n,;]/);
  const origins: string[] = [];
  for (const item of list) {
    const origin = String(item ?? '').trim();
    if (!origin) continue;
    if (origin.length > 200) throw new Error(`站点名单里的这一项太长了：${origin.slice(0, 40)}…`);
    if (/[\s;]/.test(origin)) throw new Error(`站点名单里的这一项不能含空格或分号：${origin}`);
    const shaped = /^(\*|[a-z][a-z0-9+.-]*):\/\/\S+$/i.test(origin) || /^[a-z0-9*][a-z0-9.*-]{2,}$/i.test(origin);
    if (!shaped) throw new Error(`站点名单里的这一项既不像网址也不像域名：${origin}`);
    if (!origins.includes(origin)) origins.push(origin);
    if (origins.length >= MCP_CATALOG_MAX_ORIGINS) break;
  }
  return origins;
}

/** 浏览器条目的站点名单：没存过就是不限制（两个都空）。 */
export function catalogEntryOrigins(id: unknown, options: { dataDir?: string } = {}): { allowed: string[]; blocked: string[] } {
  const entry = findCatalogEntry(id);
  if (!entry) return { allowed: [], blocked: [] };
  const saved = readCatalogState(options)[entry.id];
  return { allowed: [...(saved?.allowedOrigins || [])], blocked: [...(saved?.blockedOrigins || [])] };
}

export function setCatalogEntryOrigins(
  id: unknown,
  origins: { allowed?: unknown; blocked?: unknown },
  options: { dataDir?: string } = {},
): McpCatalogStateEntry {
  const allowed = normalizeCatalogOrigins(origins?.allowed);
  const blocked = normalizeCatalogOrigins(origins?.blocked);
  return patchCatalogState(id, { allowedOrigins: allowed, blockedOrigins: blocked }, options);
}

/** 记下/清掉最后一次失败：面板要靠它把「需要重新连接」和一般错误分开。 */
export function recordCatalogEntryError(id: unknown, error: string | null, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { lastError: error || undefined, lastErrorAt: error ? Date.now() : undefined }, options);
}

export function catalogEntryError(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return null;
  return readCatalogState(options)[entry.id]?.lastError || null;
}

export function setCatalogEntryAuthRequired(id: unknown, authRequired: boolean, options: { dataDir?: string } = {}) {
  return patchCatalogState(id, { authRequired: authRequired || undefined }, options);
}

export function catalogEntryAuthRequired(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return false;
  return readCatalogState(options)[entry.id]?.authRequired === true;
}

/** 通配匹配：`*` 参与匹配，其余字符按字面量比较（工具名里没有正则元字符，也不需要正则语义）。 */
function matchesToolPattern(pattern: unknown, toolName: string) {
  const rule = String(pattern || '').trim();
  if (!rule) return false;
  if (!rule.includes('*')) return rule === toolName;
  const body = rule
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`).test(toolName);
}

function declaredWriteGateIds(entry: McpCatalogEntry): string[] {
  return (entry.toolsets || []).flatMap((toolset) => (toolset.writes || []).map((gate) => gate.id));
}

/** 远端条目的能力组：没存过就用条目默认值。至少要留一组——全关等于让服务端把全部打开。 */
export function catalogEntryToolsets(id: unknown, options: { dataDir?: string } = {}): string[] {
  const entry = findCatalogEntry(id);
  if (!entry?.toolsets?.length) return [];
  const declared = entry.toolsets.map((toolset) => toolset.id);
  const saved = readCatalogState(options)[entry.id]?.toolsets;
  const kept = Array.isArray(saved) ? declared.filter((item) => saved.includes(item)) : [];
  if (kept.length) return kept;
  return (entry.toolSelection.defaultToolsets || []).filter((item) => declared.includes(item));
}

export function setCatalogEntryToolset(id: unknown, toolsetId: unknown, enabled: boolean, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry?.toolsets?.length) throw new Error(`${entry?.name || String(id || '')}没有可选的能力组`);
  const target = String(toolsetId || '').trim();
  if (!entry.toolsets.some((toolset) => toolset.id === target)) throw new Error(`未知的能力组：${target || '(空)'}`);
  const current = catalogEntryToolsets(entry.id, options);
  const next = enabled ? [...new Set([...current, target])] : current.filter((item) => item !== target);
  if (!next.length) throw new Error('至少要留一组能力：全关掉等于把服务端退回「全部打开」。');
  patchCatalogState(entry.id, { toolsets: next }, options);
  return next;
}

/** 写权限分项：默认一项都不开，用户要逐项打开（任务书 §22）。 */
export function catalogEntryWriteGates(id: unknown, options: { dataDir?: string } = {}): string[] {
  const entry = findCatalogEntry(id);
  if (!entry?.toolsets?.length) return [];
  const saved = readCatalogState(options)[entry.id]?.writeGates;
  if (!Array.isArray(saved) || !saved.length) return [];
  return declaredWriteGateIds(entry).filter((gateId) => saved.includes(gateId));
}

export function setCatalogEntryWriteGate(id: unknown, gateId: unknown, enabled: boolean, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry?.toolsets?.length) throw new Error(`${entry?.name || String(id || '')}没有写权限分项`);
  const target = String(gateId || '').trim();
  if (!declaredWriteGateIds(entry).includes(target)) throw new Error(`未知的写权限项：${target || '(空)'}`);
  const current = catalogEntryWriteGates(entry.id, options);
  const next = enabled ? [...new Set([...current, target])] : current.filter((item) => item !== target);
  patchCatalogState(entry.id, { writeGates: next }, options);
  return next;
}

/** 面板上显示「连的是哪个账号」；断开或换凭据时会被清掉。 */
export function catalogEntryAccount(id: unknown, options: { dataDir?: string } = {}): string {
  const entry = findCatalogEntry(id);
  if (!entry) return '';
  return String(readCatalogState(options)[entry.id]?.account || '');
}

export function setCatalogEntryAccount(id: unknown, account: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry) return '';
  const value = String(account || '').trim().slice(0, 40);
  patchCatalogState(entry.id, { account: value || undefined }, options);
  return value;
}

/** 断开连接时把写权限收回：下次连接必须重新逐项打开，不能带着上一次的授权直接回来。 */
export function clearCatalogEntryWriteGates(id: unknown, options: { dataDir?: string } = {}) {
  const entry = findCatalogEntry(id);
  if (!entry?.toolsets?.length) return [];
  patchCatalogState(entry.id, { writeGates: [] }, options);
  return [];
}

/**
 * 一个远端条目的写操作策略快照：一次读盘，翻译工具表时逐个判断，
 * 免得到时候按工具反复读同一个配置文件。
 * 返回 null 表示这个条目不区分写操作（用户自己配的服务、浏览器、文件系统都走原来的规则）。
 */
export type McpCatalogWritePolicy = {
  entryId: string;
  entryName: string;
  gates: readonly McpCatalogWriteGate[];
  enabled: readonly string[];
  forbidden: readonly string[];
};

export function catalogWritePolicy(catalogId: unknown, options: { dataDir?: string } = {}): McpCatalogWritePolicy | null {
  const entry = findCatalogEntry(catalogId);
  const gates = entry?.toolsets?.flatMap((toolset) => toolset.writes || []) || [];
  if (!entry || !gates.length) return null;
  return {
    entryId: entry.id,
    entryName: entry.name,
    gates,
    enabled: catalogEntryWriteGates(entry.id, options),
    forbidden: entry.forbiddenTools || [],
  };
}

/**
 * 写工具能不能放行：null 表示放行，否则返回要显示给用户的理由。
 * 只对「服务没标成只读」的工具调用（见 lib/mcp/tools.ts），只读工具永远不受写权限影响。
 */
export function catalogWriteToolProblem(policy: McpCatalogWritePolicy | null, toolName: unknown, allowWrite: boolean): string | null {
  if (!policy) return null;
  const name = String(toolName || '').trim();
  if (policy.forbidden.some((pattern) => matchesToolPattern(pattern, name))) {
    return `${policy.entryName} 的「${name}」属于不开放的操作（删除仓库、改密钥、force push、分支保护这类），Catalog v1 没有开关能打开它。`;
  }
  if (!allowWrite) return `会改动 ${policy.entryName} 上的数据，需要先在 MCP 面板为「${policy.entryName}」打开「允许写入」。`;
  const gate = policy.gates.find((item) => item.match.some((pattern) => matchesToolPattern(pattern, name)));
  if (!gate) return `「${name}」不在已开放的写操作清单里，Catalog v1 不会执行它。`;
  if (!policy.enabled.includes(gate.id)) return `需要先在 MCP 面板为「${policy.entryName}」打开写权限里的「${gate.label}」。`;
  return null;
}
/**
 * 组装 stdio 目录服务的运行时配置。命令永远是 Node 自己（process.execPath），
 * 脚本路径来自安装目录，用户无法影响其中任何一段。
 */
export function catalogServerConfig(
  entry: McpStdioCatalogEntry,
  options: {
    dataDir?: string;
    enabled?: boolean;
    browser?: { channel: McpCatalogBrowser | null };
    roots?: readonly string[];
    allowWrite?: boolean;
    browserMode?: McpCatalogBrowserMode;
    origins?: { allowed?: readonly string[]; blocked?: readonly string[] };
  } = {},
): McpServerConfig {
  const dataDir = catalogDataDir(options);
  const installRoot = resolveCatalogInstallRoot(entry.id, options);
  const workspace = resolveCatalogWorkspace(entry.id, options);
  try {
    mkdirSync(workspace, { recursive: true });
  } catch {}
  const browser = options.browser ?? detectSystemBrowser();
  const browserMode = options.browserMode ?? catalogEntryBrowserMode(entry.id, options);
  // 扩展模式下要接的是用户自己那份浏览器：路径按「手填 > 系统默认 > 候选」认出来。
  const browserExecutable = browserMode === 'extension' ? resolveCatalogBrowserExecutable(entry, options).path : null;
  // 免点击连接码只走环境变量：写进命令行等于把凭据摊在进程列表里。
  const extensionToken = browserMode === 'extension' ? catalogEntryExtensionToken(entry.id, options) : '';
  const env = extensionToken ? { [PLAYWRIGHT_EXTENSION_TOKEN_ENV]: extensionToken } : null;
  // 站点名单跟着条目状态走：改了名单要重连才生效（参数变了 = 换进程）。
  const origins = options.origins ?? catalogEntryOrigins(entry.id, options);
  const roots = options.roots ?? [];
  return {
    id: entry.id,
    name: entry.name,
    url: `stdio://${entry.id}`,
    transport: 'stdio',
    enabled: options.enabled ?? catalogEntryEnabled(entry.id, options),
    // 浏览器工具几乎都有副作用（点击、提交），不开写入等于装了个摆设；真正的把关放在审批链路。
    // Filesystem 相反：默认只读，写权限要用户在面板里单独打开（任务书 §13）。
    allowWrite: options.allowWrite ?? catalogEntryAllowWrite(entry.id, options),
    catalogId: entry.id,
    command: process.execPath,
    args: entry.args({
      installRoot,
      dataDir,
      browser: browser.channel,
      browserMode,
      browserExecutable,
      roots,
      allowedOrigins: origins.allowed || [],
      blockedOrigins: origins.blocked || [],
    }),
    ...(env ? { env } : {}),
    enabledTools: [...entry.allowedTools],
    cwd: workspace,
  };
}

/** 目录条目的启动条件：装好、开了开关、要目录的条目得先有授权目录。 */
export function catalogEntryReady(entry: McpCatalogEntry, options: { dataDir?: string; roots?: readonly string[] } = {}) {
  if (!isStdioCatalogEntry(entry)) return true;
  if (!isCatalogInstalled(entry, options)) return false;
  if (!catalogEntryEnabled(entry.id, options)) return false;
  if (entry.requiresRoots && !(options.roots ?? []).length) return false;
  return true;
}

/** 启用且装好的 stdio 目录服务；没装好的不出现，避免面板里摆一个点不动的入口。 */
export function listCatalogServers(options: { dataDir?: string; roots?: readonly string[] } = {}): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  // 授权目录只有一份：不传就用用户实际授权的那份。漏传一次等于「Filesystem 静默消失」，
  // 这种 bug 在面板上看起来只是「服务不见了」，很难查。
  const authorized = options.roots ?? listFilesystemRoots({ dataDir: options.dataDir });
  for (const entry of stdioCatalogEntries()) {
    const roots = authorized;
    if (entry.requiresRoots && !roots.length) continue;
    if (!catalogEntryReady(entry, { ...options, roots })) continue;
    servers.push(catalogServerConfig(entry, { ...options, enabled: true, roots }));
  }
  return servers;
}

/**
 * 远端目录条目的「连接 / 配置 / 断开」。
 *
 * 远端条目（GitHub、Context7）不下载任何东西：连接 = 往 `.data/mcp/servers.json` 写一份
 * 带凭据的服务配置。这样探测、工具白名单、按需下发、审批全部复用用户自己配服务的那条链路，
 * 不必再维护一套只对官方条目生效的逻辑。
 *
 * 凭据永远只回键名（见 lib/mcp/store.ts 的 redactMcpServer）：面板只知道「配没配」，
 * 拿不到值。
 */
import { callMcpTool, probeMcpServer, resetMcpSessions } from './client';
import {
  catalogEntryAllowWrite,
  catalogEntryAuthRequired,
  catalogEntryEnabled,
  catalogEntryError,
  setCatalogEntryAccount,
  catalogEntryToolsets,
  clearCatalogEntryWriteGates,
  isRemoteCatalogEntry,
  recordCatalogEntryError,
  setCatalogEntryAllowWrite,
  setCatalogEntryAuthRequired,
  setCatalogEntryEnabled,
  setCatalogEntryToolset,
  type McpCatalogEntry,
  type McpRemoteCatalogEntry,
} from './catalog';
import { listMcpServers, patchMcpServer, removeMcpServer, upsertMcpServer } from './store';
import { clearMcpToolCache } from './tools';
import type { McpServerConfig } from './types';

/** 面板上的统一状态（任务书 §4）。远端条目没有「安装」，not_installed 由界面翻成「未连接」。 */
export type McpCatalogConnectionState =
  | 'unavailable'
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'connecting'
  | 'connected'
  | 'auth_required'
  | 'error'
  | 'disabled';

export type McpCatalogRemoteOptions = { dataDir?: string; fetchImpl?: typeof fetch };

/**
 * 连上之后顺手问一句「当前账号是谁」：面板显示 @login 比只写「已连接」有用，
 * 用户一眼能确认没有连错账号。这只读调用是尽力而为：工具不存在、返回不是预期结构、
 * 或者慢了一点，都只是拿不到名字，不影响连接结果。
 */
async function fetchRemoteAccount(entry: McpCatalogEntry, server: McpServerConfig, options: McpCatalogRemoteOptions): Promise<string> {
  if (entry.id !== 'github') return '';
  try {
    const result = await callMcpTool(server, 'get_me', {}, { fetchImpl: options.fetchImpl, timeouts: { init: 6_000, call: 6_000 } });
    if (result.isError) return '';
    const payload = JSON.parse(result.text) as { login?: unknown; user?: { login?: unknown } };
    const login = String(payload?.login || payload?.user?.login || '').trim();
    // 只接受 GitHub 用户名形态，别把任意文本当账号名显示出来。
    return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) ? login : '';
  } catch {
    return '';
  }
}

/** 正在连接的条目：面板轮询时能看到 connecting，而不是一闪而过的空白。 */
const connecting = new Set<string>();

export function isCatalogEntryConnecting(id: unknown) {
  return connecting.has(String(id || '').trim());
}

/** 401/403 一律归到「凭据要重来」：面板给的下一步是重新连接，不是看日志。 */
function isAuthFailure(message: string) {
  return /\b(401|403)\b|unauthorized|forbidden|bad credentials|invalid token|token.*expired/i.test(message);
}

export function findRemoteCatalogServer(entry: McpCatalogEntry, options: { dataDir?: string } = {}): McpServerConfig | null {
  return listMcpServers(options).find((server) => server.id === entry.id) || null;
}

/**
 * GitHub 官方远端服务的开关都在请求头上（docs/remote-server.md）：
 * X-MCP-Toolsets 控制能力面，X-MCP-Readonly 关掉全部写工具，X-MCP-Lockdown 降 prompt injection 风险。
 * 只读时我们自己也不下发写工具（allowWrite=false），两层都在。
 *
 * 空的能力组不进请求头：服务端看到缺省值会把所有组都打开，那不是用户想要的结果，
 * 所以调用方要先保证至少留一组（见 setCatalogEntryToolset）。
 */
export function remoteCatalogDefaultHeaders(entry: McpRemoteCatalogEntry, allowWrite: boolean, toolsets?: readonly string[]): Record<string, string> {
  if (entry.id !== 'github') return {};
  const list = (toolsets ?? entry.toolSelection.defaultToolsets ?? []).filter(Boolean);
  return {
    ...(list.length ? { 'x-mcp-toolsets': list.join(',') } : {}),
    'x-mcp-readonly': allowWrite ? 'false' : 'true',
    'x-mcp-lockdown': 'true',
  };
}

function tokenHeaders(entry: McpRemoteCatalogEntry, token: string) {
  const headerName = String(entry.auth?.headerName || '').trim().toLowerCase();
  if (!token || !headerName) return {};
  return { [headerName]: `${entry.auth?.headerPrefix || ''}${token}` };
}

export type ConnectRemoteResult = { state: McpCatalogConnectionState; error: string | null };

/**
 * 连接：写配置 → 探测（initialize + tools/list）→ 记状态。
 * 探测失败不删配置：用户可能只是暂时没网，凭据也已经填过了。
 */
export async function connectRemoteCatalogEntry(entry: McpCatalogEntry, options: McpCatalogRemoteOptions & { token?: string } = {}): Promise<ConnectRemoteResult> {
  if (!isRemoteCatalogEntry(entry)) throw new Error(`${entry.name} 不是远端连接器`);
  const token = String(options.token || '').trim();
  const existing = findRemoteCatalogServer(entry, options);
  if (entry.setup.requiresAuth && !token && !existing?.headers?.[String(entry.auth?.headerName || '').toLowerCase()]) {
    throw new Error(`需要先填写${entry.auth?.label || '凭据'}`);
  }
  if (token.length > 4000) throw new Error('凭据过长');
  const allowWrite = catalogEntryAllowWrite(entry.id, options);
  const headers = {
    ...remoteCatalogDefaultHeaders(entry, allowWrite, catalogEntryToolsets(entry.id, options)),
    ...(existing?.headers || {}),
    ...tokenHeaders(entry, token),
  };
  const server = upsertMcpServer({
    id: entry.id,
    name: entry.name,
    url: entry.url,
    enabled: true,
    allowWrite,
    headers,
    ...(entry.allowedTools.length ? { enabledTools: [...entry.allowedTools] } : {}),
    ...(entry.toolSelection.lazy ? { lazy: true } : {}),
    catalogId: entry.id,
  }, { ...options, allowCatalogId: true });
  clearMcpToolCache(server.id);
  resetMcpSessions(server.url);
  setCatalogEntryEnabled(entry.id, true, options);
  connecting.add(entry.id);
  try {
    await probeMcpServer(server, { fetchImpl: options.fetchImpl, retry: true, timeouts: { init: 20_000, list: 20_000 } });
    setCatalogEntryAuthRequired(entry.id, false, options);
    recordCatalogEntryError(entry.id, null, options);
    const account = await fetchRemoteAccount(entry, server, options);
    if (account) setCatalogEntryAccount(entry.id, account, options);
    return { state: 'connected', error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接失败';
    const authRequired = entry.setup.requiresAuth || entry.auth?.kind === 'token' ? isAuthFailure(message) : false;
    setCatalogEntryAuthRequired(entry.id, authRequired, options);
    recordCatalogEntryError(entry.id, message, options);
    return { state: authRequired ? 'auth_required' : 'error', error: message };
  } finally {
    connecting.delete(entry.id);
  }
}

/**
 * 改能力组：请求头变了，服务端公布的工具体系就变了，所以要重连一次才算数。
 * 还没连接时只记状态——下次连接时自然会带上新的组。
 */
export async function setRemoteCatalogToolset(
  entry: McpCatalogEntry,
  toolsetId: unknown,
  enabled: boolean,
  options: McpCatalogRemoteOptions = {},
): Promise<ConnectRemoteResult> {
  if (!isRemoteCatalogEntry(entry)) throw new Error(`${entry.name} 不是远端连接器`);
  setCatalogEntryToolset(entry.id, toolsetId, enabled, options);
  clearMcpToolCache(entry.id);
  const server = findRemoteCatalogServer(entry, options);
  if (!server || !server.enabled) return { state: remoteCatalogConnectionState(entry, options), error: null };
  return configureRemoteCatalogEntry(entry, {}, options);
}

/** 断开：删掉本机这份配置（含凭据），写权限也一起收回去。 */
export function disconnectRemoteCatalogEntry(entry: McpCatalogEntry, options: { dataDir?: string } = {}) {
  if (!isRemoteCatalogEntry(entry)) throw new Error(`${entry.name} 不是远端连接器`);
  const server = findRemoteCatalogServer(entry, options);
  const removed = removeMcpServer(entry.id, options);
  if (server) resetMcpSessions(server.url);
  clearMcpToolCache(entry.id);
  setCatalogEntryEnabled(entry.id, false, options);
  setCatalogEntryAuthRequired(entry.id, false, options);
  setCatalogEntryAccount(entry.id, '', options);
  clearCatalogEntryWriteGates(entry.id, options);
  recordCatalogEntryError(entry.id, null, options);
  return { removed };
}

/**
 * 改配置：换凭据、打开/关闭写入、改工具白名单与按需下发。
 * 换凭据时顺手清掉上一次的失败记录，否则面板会一直显示旧的错误。
 */
export async function configureRemoteCatalogEntry(
  entry: McpCatalogEntry,
  patch: { token?: string; allowWrite?: boolean; enabledTools?: unknown; lazy?: boolean; enabled?: boolean; retest?: boolean },
  options: McpCatalogRemoteOptions = {},
): Promise<ConnectRemoteResult> {
  if (!isRemoteCatalogEntry(entry)) throw new Error(`${entry.name} 不是远端连接器`);
  const server = findRemoteCatalogServer(entry, options);
  if (!server) throw new Error(`${entry.name} 还没有连接`);
  const token = String(patch.token ?? '').trim();
  if (token.length > 4000) throw new Error('凭据过长');
  const allowWrite = typeof patch.allowWrite === 'boolean' ? patch.allowWrite : server.allowWrite;
  // 写权限是两处的事：本机记一份（面板徽标、工具表缓存都用它），请求头一份。
  // 只改请求头的话，下面这次重连又会按本机的旧值把请求头写回去，等于白改。
  if (typeof patch.allowWrite === 'boolean') setCatalogEntryAllowWrite(entry.id, patch.allowWrite, options);
  // 只读是请求头上的开关：改写入权限时必须把 x-mcp-readonly 一起改掉，否则会「本机放行、服务端拒绝」。
  const headers = {
    ...(server.headers || {}),
    ...remoteCatalogDefaultHeaders(entry, allowWrite, catalogEntryToolsets(entry.id, options)),
    ...tokenHeaders(entry, token),
  };
  patchMcpServer(entry.id, {
    enabled: patch.enabled,
    allowWrite,
    enabledTools: patch.enabledTools,
    lazy: patch.lazy,
  }, options);
  upsertMcpServer({ ...server, headers, allowWrite, enabled: patch.enabled === undefined ? server.enabled : patch.enabled }, { ...options, allowCatalogId: true });
  clearMcpToolCache(entry.id);
  resetMcpSessions(server.url);
  if (token) {
    setCatalogEntryAuthRequired(entry.id, false, options);
    recordCatalogEntryError(entry.id, null, options);
  }
  if (patch.retest === false) return { state: 'connected', error: null };
  return connectRemoteCatalogEntry(entry, { ...options, token: '' });
}

/** 远端条目的状态：没配置 → 未连接；配了没开 → 已停用；探测失败 → 需要重连 / 出错。 */
export function remoteCatalogConnectionState(entry: McpCatalogEntry, options: { dataDir?: string } = {}): McpCatalogConnectionState {
  if (!isRemoteCatalogEntry(entry)) return 'unavailable';
  if (isCatalogEntryConnecting(entry.id)) return 'connecting';
  const server = findRemoteCatalogServer(entry, options);
  if (!server) return 'not_installed';
  if (!server.enabled || !catalogEntryEnabled(entry.id, options)) return 'disabled';
  if (catalogEntryAuthRequired(entry.id, options)) return 'auth_required';
  if (catalogEntryError(entry.id, options)) return 'error';
  return 'connected';
}

/** 目录条目对外的状态：stdio 看运行时，远端看配置与最近一次探测。 */
export function catalogEntryState(
  entry: McpCatalogEntry,
  options: { dataDir?: string; roots?: readonly string[]; runtime?: { state: string; installed?: boolean } } = {},
): McpCatalogConnectionState {
  if (isRemoteCatalogEntry(entry)) return remoteCatalogConnectionState(entry, options);
  const runtime = options.runtime;
  if (options.runtime && options.runtime.state === 'installing') return 'installing';
  if (options.runtime && options.runtime.state === 'error') return 'error';
  if (!catalogEntryEnabled(entry.id, options)) {
    return options.runtime?.installed ? 'disabled' : 'not_installed';
  }
  // 开了开关但缺前置条件（Filesystem 没有授权目录）：这里给 unavailable，
  // 面板据此显示「还差什么」，而不是让用户点启动再吃一个报错。
  if (entry.requiresRoots && !(options.roots || []).length) return 'unavailable';
  if (runtime?.state === 'running') return 'connected';
  return 'installed';
}
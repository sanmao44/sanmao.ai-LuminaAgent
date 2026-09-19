import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import type { McpServerConfig } from './types';

export const MCP_MAX_SERVERS = 20;
export const MCP_MAX_HEADERS = 12;
export const MCP_MAX_HEADER_CHARS = 2000;
export const MCP_MAX_TOOLS_PER_SERVER = 60;

type McpStoreOptions = { dataDir?: string };

/** 服务配置存本地数据目录，和技能目录同级；不写进仓库，也不进前端状态。 */
export function resolveMcpStoreFile(options: McpStoreOptions = {}) {
  const dir = options.dataDir || resolveLocalDataDir();
  return path.join(dir, 'mcp', 'servers.json');
}

export function normalizeMcpServerId(value: unknown, fallback = 'server') {
  const raw = String(value ?? '').trim().toLowerCase();
  // 工具名会拼成 <serverId>__<tool>，所以 id 必须以字母数字开头，且不能含双下划线。
  const slug = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').replace(/__+/g, '-').slice(0, 32);
  const safe = /^[a-z0-9][a-z0-9_-]*$/.test(slug) ? slug : '';
  return safe || fallback;
}

function uniqueId(base: string, used: Set<string>) {
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now() % 1000}`;
}

function normalizeHeaders(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value as Record<string, unknown>).slice(0, MCP_MAX_HEADERS)) {
    const name = String(key || '').trim().toLowerCase();
    // 请求头只允许名字段，值里的换行会被下游 fetch 拒绝，直接挡在这里。
    if (!/^[a-z0-9-]{1,64}$/.test(name) || /^(host|content-length|connection)$/.test(name)) continue;
    // 空白值等于没配；顺便去掉首尾空白，免得把一个看起来配了的空凭据发出去。
    const text = String(header ?? '').trim().slice(0, MCP_MAX_HEADER_CHARS);
    if (!text || /[\r\n]/.test(text)) continue;
    headers[name] = text;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function normalizeEnabledTools(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item && item.length <= 120)
    .slice(0, MCP_MAX_TOOLS_PER_SERVER);
  return names.length ? Array.from(new Set(names)) : undefined;
}

export function normalizeMcpServerUrl(value: unknown) {
  const url = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('MCP 服务地址必须是 http(s) 开头');
  if (url.length > 500) throw new Error('MCP 服务地址过长');
  // 只保留 URL 结构，避免把用户名密码这类信息塞进来当"地址"。
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) throw new Error('MCP 服务地址不能带用户名密码，请改用请求头');
    return parsed.toString();
  } catch (error) {
    throw error instanceof Error && error.message.includes('用户名密码') ? error : new Error('MCP 服务地址不是合法 URL');
  }
}

/** 校验并归一化一条服务配置；非法输入抛错，避免半截配置写进文件。 */
export function normalizeMcpServerInput(raw: unknown, options: { existingId?: string; usedIds?: Set<string> } = {}): McpServerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MCP 服务配置必须是对象');
  const input = raw as Record<string, unknown>;
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('MCP 服务需要一个名称');
  const existingId = options.existingId ? normalizeMcpServerId(options.existingId) : '';
  const requestedId = existingId || normalizeMcpServerId(input.id || name, `server-${(options.usedIds?.size || 0) + 1}`);
  const used = options.usedIds || new Set<string>();
  const id = used.has(requestedId) ? uniqueId(requestedId, used) : requestedId;
  const headers = normalizeHeaders(input.headers);
  const enabledTools = normalizeEnabledTools(input.enabledTools);
  return {
    id,
    name,
    url: normalizeMcpServerUrl(input.url),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    allowWrite: Boolean(input.allowWrite),
    ...(headers ? { headers } : {}),
    ...(enabledTools ? { enabledTools } : {}),
  };
}

/** 对外（前端/日志）返回的配置：请求头只留键名，值不回传。 */
export function redactMcpServer(config: McpServerConfig) {
  return {
    id: config.id,
    name: config.name,
    url: config.url,
    enabled: config.enabled,
    allowWrite: config.allowWrite,
    headerNames: Object.keys(config.headers || {}),
    hasHeaders: Boolean(Object.keys(config.headers || {}).length),
    enabledTools: config.enabledTools || [],
  };
}

export function listMcpServers(options: McpStoreOptions = {}): McpServerConfig[] {
  const file = resolveMcpStoreFile(options);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const servers = Array.isArray(parsed?.servers) ? parsed.servers : [];
    return servers
      .map((item: unknown) => {
        try {
          return normalizeMcpServerInput(item, { existingId: (item as { id?: string })?.id });
        } catch {
          return null;
        }
      })
      .filter((item: McpServerConfig | null): item is McpServerConfig => Boolean(item))
      .slice(0, MCP_MAX_SERVERS);
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: readonly McpServerConfig[], options: McpStoreOptions = {}) {
  const file = resolveMcpStoreFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({ version: 1, servers: servers.slice(0, MCP_MAX_SERVERS) }, null, 2) + '\n';
  // 先写临时文件再改名，避免进程中断留下半截 JSON 导致配置整体读不出来。
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, payload, 'utf8');
  renameSync(temporary, file);
  return servers.slice(0, MCP_MAX_SERVERS);
}

export function upsertMcpServer(input: unknown, options: McpStoreOptions = {}) {
  const servers = listMcpServers(options);
  const id = String((input as { id?: string })?.id || '').trim();
  const index = id ? servers.findIndex((server) => server.id === normalizeMcpServerId(id)) : -1;
  const usedIds = new Set(servers.filter((_server, position) => position !== index).map((server) => server.id));
  if (index < 0 && servers.length >= MCP_MAX_SERVERS) throw new Error(`最多添加 ${MCP_MAX_SERVERS} 个 MCP 服务`);
  const next = normalizeMcpServerInput(input, { existingId: index >= 0 ? servers[index].id : '', usedIds });
  const merged: McpServerConfig = index >= 0 ? { ...servers[index], ...next, id: servers[index].id } : next;
  const updated = index >= 0 ? servers.map((server, position) => (position === index ? merged : server)) : [...servers, merged];
  saveMcpServers(updated, options);
  return merged;
}

export function removeMcpServer(id: unknown, options: McpStoreOptions = {}) {
  const target = normalizeMcpServerId(id);
  const servers = listMcpServers(options);
  const updated = servers.filter((server) => server.id !== target);
  if (updated.length === servers.length) return false;
  saveMcpServers(updated, options);
  return true;
}

export function patchMcpServer(id: unknown, patch: { enabled?: boolean; allowWrite?: boolean; enabledTools?: unknown }, options: McpStoreOptions = {}) {
  const target = normalizeMcpServerId(id);
  const servers = listMcpServers(options);
  const index = servers.findIndex((server) => server.id === target);
  if (index < 0) return null;
  const current = servers[index];
  const next: McpServerConfig = { ...current };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.allowWrite === 'boolean') next.allowWrite = patch.allowWrite;
  if (patch.enabledTools !== undefined) {
    const enabledTools = normalizeEnabledTools(patch.enabledTools);
    if (enabledTools) next.enabledTools = enabledTools;
    else delete next.enabledTools;
  }
  const updated = next;
  saveMcpServers(servers.map((server, position) => (position === index ? updated : server)), options);
  return updated;
}

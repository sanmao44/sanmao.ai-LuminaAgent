import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import { listCatalogServers } from './catalog';
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

/** 云厂商的实例元数据地址：读到就等于拿到机器上的临时凭据，任何情况下都不接。 */
const MCP_BLOCKED_METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', '100.100.100.200', 'fd00:ec2::254']);

/**
 * 链路本地地址（169.254.0.0/16、fe80::/10，含 IPv4 映射写法）是元数据服务的落脚点，
 * 按字面量挡掉。这里不做 DNS 解析：解析结果随时会变，校验阶段拿到的事实不可靠。
 */
function toIpv4Literal(host: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  // URL 会把 ::ffff:169.254.169.254 归一化成 ::ffff:a9fe:a9fe，这里再还原回点分四段。
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return '';
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isBlockedMetadataHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (MCP_BLOCKED_METADATA_HOSTS.has(host)) return true;
  if (/^169\.254\./.test(toIpv4Literal(host))) return true;
  return /^fe[89ab][0-9a-f]:/.test(host);
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
    if (isBlockedMetadataHost(parsed.hostname)) throw new Error('MCP 服务地址不能是链路本地地址或云厂商的实例元数据地址');
    return parsed.toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('用户名密码') || message.includes('元数据')) throw error as Error;
    throw new Error('MCP 服务地址不是合法 URL');
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
  return [...readUserMcpServers(options), ...listCatalogServers(options)].slice(0, MCP_MAX_SERVERS);
}

/**
 * 用户自己配的服务（remote http）。
 * 目录服务（stdio）不在这份文件里，见 lib/mcp/catalog.ts：命令来自代码，不来自用户输入。
 */
function readUserMcpServers(options: McpStoreOptions = {}): McpServerConfig[] {
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
  // 请求头里可能有 token，文件权限按仅本人可读写（Windows 上由 ACL 决定，这里是尽力而为）。
  writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });
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

import { MCP_MAX_TOOLS_PER_SERVER, listMcpServers } from './store';
import { listMcpServerTools } from './client';
import type { McpTimeouts } from './client';
import type { McpRemoteTool, McpServerConfig } from './types';
import type { ToolDefinition } from '@/lib/tools/registry';

/** 模型看到的 MCP 工具名是 <serverId>__<toolName>，避免不同服务的同名工具互相覆盖。 */
export const MCP_TOOL_SEPARATOR = '__';
export const MCP_TOOL_CACHE_TTL_MS = 60_000;
export const MCP_MAX_TOOL_DESCRIPTION_CHARS = 600;
export const MCP_MAX_TOOL_SCHEMA_CHARS = 12_000;
/** 一轮对话里最多下发多少个 MCP 工具，以及它们的参数结构合计多大。 */
export const MCP_MAX_TOOL_DEFINITIONS_PER_TURN = 48;
export const MCP_MAX_SCHEMA_CHARS_PER_TURN = 60_000;

export function mcpToolId(serverId: string, toolName: string) {
  return `${serverId}${MCP_TOOL_SEPARATOR}${toolName}`;
}

export function isMcpReadOnlyTool(tool: McpRemoteTool) {
  return tool.annotations?.readOnlyHint === true;
}

function inputSchemaOf(tool: McpRemoteTool) {
  const schema = tool.inputSchema;
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) return schema as Record<string, unknown>;
  return { type: 'object', properties: {} };
}

/**
 * 服务的 schema 是原样透传给模型的，啰嗦或恶意的服务可以靠它把上下文撑爆。
 * 超限的工具直接不下发；面板自检里会把它标出来，不会让用户以为它可用。
 */
export function isMcpToolSchemaTooLarge(tool: McpRemoteTool) {
  try {
    return JSON.stringify(inputSchemaOf(tool)).length > MCP_MAX_TOOL_SCHEMA_CHARS;
  } catch {
    return true;
  }
}

/** 把 MCP 服务公布的工具翻译成注册表条目；权限由 annotations 推导，写入类默认拒绝。 */
export function mcpToolDefinitions(server: McpServerConfig, tools: readonly McpRemoteTool[]): ToolDefinition[] {
  const allowed = new Set(server.enabledTools || []);
  const selected = tools
    .filter((tool) => (!allowed.size || allowed.has(tool.name)) && !isMcpToolSchemaTooLarge(tool))
    .slice(0, MCP_MAX_TOOLS_PER_SERVER);
  return selected.map((tool) => {
    const readOnly = isMcpReadOnlyTool(tool);
    return {
      name: mcpToolId(server.id, tool.name),
      description: `[MCP · ${server.name}] ${String(tool.description || tool.title || tool.name).trim().slice(0, MCP_MAX_TOOL_DESCRIPTION_CHARS)}`,
      schema: inputSchemaOf(tool),
      permissions: readOnly ? ['network'] : ['network', 'external:write'],
      tags: ['mcp'],
      source: 'mcp',
      // 服务没启用时根本不会构建这些定义，所以门控恒真；真正的拦截在权限校验里。
      gating: () => true,
      mcp: { serverId: server.id, serverName: server.name, toolName: tool.name, readOnly, blocked: !readOnly && !server.allowWrite },
    } satisfies ToolDefinition;
  });
}

/**
 * 每个服务的工具数有上限，但服务本身可以有 20 个：真接满时工具表能到上百个，
 * 光下发就要几十万字符。这里按配置顺序截断，超出的这轮不下发——
 * 宁可让助手说"这个服务这轮没挂上"，也不让一次对话被工具表拖垮。
 */
export function boundMcpToolPayload(definitions: readonly ToolDefinition[]) {
  const bounded: ToolDefinition[] = [];
  let schemaChars = 0;
  for (const definition of definitions) {
    if (bounded.length >= MCP_MAX_TOOL_DEFINITIONS_PER_TURN) break;
    let size = 0;
    try {
      size = JSON.stringify(definition.schema).length;
    } catch {
      continue;
    }
    if (schemaChars + size > MCP_MAX_SCHEMA_CHARS_PER_TURN) break;
    schemaChars += size;
    bounded.push(definition);
  }
  return bounded;
}

type McpToolCacheEntry = { at: number; tools: ToolDefinition[] };
const toolCache = new Map<string, McpToolCacheEntry>();

type McpLoadOptions = {
  servers?: readonly McpServerConfig[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeouts?: McpTimeouts;
  signal?: AbortSignal;
  cache?: boolean;
  dataDir?: string;
};

export type McpToolRuntime = { servers: McpServerConfig[]; tools: ToolDefinition[] };

export function clearMcpToolCache(serverId?: string) {
  if (serverId) toolCache.delete(serverId);
  else toolCache.clear();
}

/**
 * 拉取已启用服务的工具，best-effort：单个服务连不上或超时只跳过它，
 * 不能让 MCP 的可用性影响到普通对话。
 */
async function loadForServers(servers: readonly McpServerConfig[], options: McpLoadOptions): Promise<ToolDefinition[]> {
  if (!servers.length) return [];
  const now = options.now || Date.now;
  const cacheable = options.cache !== false;
  const definitions: ToolDefinition[] = [];
  const settled = await Promise.all(servers.map(async (server) => {
    const cached = cacheable ? toolCache.get(server.id) : undefined;
    if (cached && now() - cached.at < MCP_TOOL_CACHE_TTL_MS) return cached.tools;
    try {
      const tools = await listMcpServerTools(server, { fetchImpl: options.fetchImpl, now: options.now, timeouts: options.timeouts, signal: options.signal });
      const built = mcpToolDefinitions(server, tools);
      if (cacheable) toolCache.set(server.id, { at: now(), tools: built });
      return built;
    } catch {
      return [] as ToolDefinition[];
    }
  }));
  for (const items of settled) definitions.push(...items);
  return boundMcpToolPayload(definitions);
}

/**
 * 一次把「这轮要用的服务」和「它们的工具」取回来：Agent 路由不用再读一遍配置文件，
 * 服务表和工具表也一定来自同一份快照，不会出现工具能列出、服务却找不到的错位。
 */
export async function loadMcpToolRuntime(options: McpLoadOptions = {}): Promise<McpToolRuntime> {
  const servers = (options.servers || listMcpServers({ dataDir: options.dataDir })).filter((server) => server.enabled);
  return { servers: [...servers], tools: await loadForServers(servers, options) };
}

export async function loadMcpToolDefinitions(options: McpLoadOptions = {}): Promise<ToolDefinition[]> {
  return loadForServers((options.servers || listMcpServers({ dataDir: options.dataDir })).filter((server) => server.enabled), options);
}

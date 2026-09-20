import { MCP_MAX_TOOLS_PER_SERVER, listMcpServers } from './store';
import { listMcpServerTools } from './client';
import type { McpTimeouts } from './client';
import type { McpRemoteTool, McpServerConfig } from './types';
import { catalogWritePolicy, catalogWriteToolProblem, findCatalogEntry } from './catalog';
import { isValidToolName, type ToolDefinition } from '@/lib/tools/registry';

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

/**
 * 任何来源都不下发的工具。
 *
 * browser_run_code_unsafe 在 MCP 服务进程里跑任意 JS：等于把整台机器交给模型，
 * 而且它不在 --caps 后面，光靠启动参数关不掉。目录白名单已经排除了它，
 * 这里再兜一道，免得用户配置里的旧清单又把它放回来。
 */
export const MCP_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set(['browser_run_code_unsafe']);

/** 注册表里的运行时 id，和模型看到的名字分开记：名字是给人看的，id 给审计用。 */
export function mcpRuntimeToolId(serverId: string, toolName: string) {
  return `mcp:${serverId}:${toolName}`;
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

/**
 * 把 MCP 服务公布的工具翻译成注册表条目；权限由 annotations 推导，写入类默认拒绝。
 *
 * 目录条目还多一道：GitHub 这类远端连接器的写操作要逐项授权（任务书 §22），
 * 没打开的项连调用都不放行，理由会带在 blockedReason 里，让助手能直说要打开哪一项。
 */
export function mcpToolDefinitions(server: McpServerConfig, tools: readonly McpRemoteTool[], options: { dataDir?: string } = {}): ToolDefinition[] {
  // 内置连接器的工具清单以代码为准：用户配置里那份可能是旧版本写的，甚至包含代码已经排除的工具。
  // 远端连接器（GitHub 等）白名单为空，表示「不限制」，仍然沿用用户勾选的那份清单。
  const catalogWhitelist = server.catalogId ? (findCatalogEntry(server.catalogId)?.allowedTools || []) : [];
  const allowed = new Set(catalogWhitelist.length ? catalogWhitelist : server.enabledTools || []);
  // 写操作策略一次读盘、按需取：没有写权限分项的条目根本不会去读配置。
  let writePolicy: ReturnType<typeof catalogWritePolicy> | undefined;
  const selected = tools
    // 名字要能直接当 function name 下发：上游只接受 [A-Za-z0-9_-]，服务公布怪名字就直接跳过，
    // 否则这一轮整个工具表都会被服务商判成非法请求。
    .filter((tool) => !MCP_FORBIDDEN_TOOLS.has(tool.name) && (!allowed.size || allowed.has(tool.name)) && !isMcpToolSchemaTooLarge(tool) && isValidToolName(mcpToolId(server.id, tool.name)))
    .slice(0, MCP_MAX_TOOLS_PER_SERVER);
  return selected.map((tool) => {
    const readOnly = isMcpReadOnlyTool(tool);
    let blocked = !readOnly && !server.allowWrite;
    let blockedReason = '';
    if (!readOnly) {
      if (writePolicy === undefined) writePolicy = catalogWritePolicy(server.catalogId, { dataDir: options.dataDir });
      const problem = catalogWriteToolProblem(writePolicy, tool.name, server.allowWrite);
      if (problem) {
        blocked = true;
        blockedReason = problem;
      }
    }
    return {
      id: mcpRuntimeToolId(server.id, tool.name),
      name: mcpToolId(server.id, tool.name),
      description: `[MCP · ${server.name}] ${String(tool.description || tool.title || tool.name).trim().slice(0, MCP_MAX_TOOL_DESCRIPTION_CHARS)}`,
      schema: inputSchemaOf(tool),
      permissions: readOnly ? ['network'] : ['network', 'external:write'],
      tags: ['mcp'],
      source: 'mcp',
      // 只读工具动不了外部数据；写工具即使被放行，也是改动本机以外的东西。
      risk: readOnly ? 'read' : 'external_side_effect',
      // 服务没启用时根本不会构建这些定义，所以门控恒真；真正的拦截在权限校验里。
      gating: () => true,
      mcp: {
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
        readOnly,
        blocked,
        ...(blockedReason ? { blockedReason } : {}),
      },
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

/** 按需下发的服务最多带多少个关键词：够用就好，太多等于没过滤。 */
export const MCP_LAZY_KEYWORD_LIMIT = 24;

/**
 * 「按需下发」服务的关键词表（面板里给单个服务勾选）。
 *
 * 打开后，只有这一轮的文字里提到这个服务（服务名或它公布的工具名）才会整组挂上；
 * 没打开的服务保持原样加载——用户主动接进来的服务突然不给他用才是 bug。
 * 关键词只决定「这一轮要不要加载」，不参与权限校验：多命中一个词最多多花点 token。
 */
export function lazyMcpGroupKeywords(
  servers: readonly McpServerConfig[],
  tools: readonly ToolDefinition[],
): Record<string, readonly string[]> {
  const keywords: Record<string, readonly string[]> = {};
  for (const server of servers) {
    if (server.lazy !== true) continue;
    const words = new Set<string>([server.id]);
    const catalog = server.catalogId ? findCatalogEntry(server.catalogId) : null;
    for (const keyword of catalog?.intentKeywords || []) {
      const normalized = String(keyword || '').trim().toLowerCase();
      if (normalized.length >= 2) words.add(normalized);
    }
    const collect = (value: string, minimum: number) => {
      for (const token of String(value || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/)) {
        if (token.length >= minimum) words.add(token);
      }
    };
    collect(server.name, 2);
    for (const tool of tools) {
      if (tool.mcp?.serverId !== server.id) continue;
      collect(tool.mcp.toolName, 3);
    }
    keywords[`mcp:${server.id}`] = [...words].slice(0, MCP_LAZY_KEYWORD_LIMIT);
  }
  return keywords;
}

type McpToolCacheEntry = { at: number; tools: ToolDefinition[] };
const toolCache = new Map<string, McpToolCacheEntry>();

type McpLoadOptions = {
  servers?: readonly McpServerConfig[];
  /** 本轮优先保留的服务 id；用于避免关键服务被全局工具预算截断。 */
  priorityServerIds?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeouts?: McpTimeouts;
  signal?: AbortSignal;
  cache?: boolean;
  dataDir?: string;
  /** Filesystem 条目的授权目录；不传就用本地存的授权清单（见 lib/mcp/store.ts）。 */
  roots?: readonly string[];
};

export type McpToolRuntime = { servers: McpServerConfig[]; tools: ToolDefinition[] };

function orderMcpServers(servers: readonly McpServerConfig[], priorityServerIds: readonly string[] = []) {
  if (!priorityServerIds.length || servers.length < 2) return [...servers];
  const priority = new Set(priorityServerIds.map((id) => String(id).trim()).filter(Boolean));
  if (!priority.size) return [...servers];
  return [...servers].sort((left, right) => Number(priority.has(right.id)) - Number(priority.has(left.id)));
}

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
      const built = mcpToolDefinitions(server, tools, { dataDir: options.dataDir });
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
  const servers = (options.servers || listMcpServers({ dataDir: options.dataDir, roots: options.roots })).filter((server) => server.enabled);
  return { servers: [...servers], tools: await loadForServers(orderMcpServers(servers, options.priorityServerIds), options) };
}

export async function loadMcpToolDefinitions(options: McpLoadOptions = {}): Promise<ToolDefinition[]> {
  const servers = (options.servers || listMcpServers({ dataDir: options.dataDir, roots: options.roots })).filter((server) => server.enabled);
  return loadForServers(orderMcpServers(servers, options.priorityServerIds), options);
}

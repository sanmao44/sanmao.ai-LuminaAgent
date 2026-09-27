/**
 * MCP 管理动作的执行层：agent 的 mcp_manage 工具走这里，以后面板的批量操作也可以复用。
 *
 * 只改本机配置，不碰远程数据；两件危险的事（打开写入权限、删除服务）要求用户原话里
 * 明确说了才放行——授权依据不交给模型自己声明。
 */
import { probeMcpServer, resetMcpSessions } from './client';
import {
  MCP_MAX_SERVERS,
  listMcpServers,
  normalizeMcpServerId,
  patchMcpServer,
  redactMcpServer,
  removeMcpServer,
  upsertMcpServer,
} from './store';
import { findCatalogEntry } from './catalog';
import { clearMcpToolCache, isMcpToolSchemaTooLarge } from './tools';
import { installGithubMcpFromRepo } from './repo-installer';
import type { McpRemoteTool, McpServerConfig } from './types';

export const MCP_ADMIN_ACTIONS = ['list', 'probe', 'add', 'update', 'remove', 'install_from_repo'] as const;
export type McpAdminAction = (typeof MCP_ADMIN_ACTIONS)[number];

/** 打开写入权限、删除服务必须能在用户原话里找到依据。 */
const WRITE_GRANT_PATTERN = /(?:允许写入|允许写|开启写入|打开写入|可以写入|允许修改|允许删除|允许新建)/;
const REMOVE_GRANT_PATTERN = /(?:删除|移除|删掉|断开|取消接入|不再使用)/;
const PROBE_TIMEOUT_MS = 20_000;
const TOOL_DESCRIPTION_CHARS = 200;

export type McpManageOptions = {
  /** 用户这一轮的原话，用来校验危险动作的授权。 */
  instruction?: string;
  /**
   * 服务端已经从用户本轮原话中提取并确认的 GitHub 仓库地址。
   * 只由 Agent 路由传入，不能由模型工具参数提供。
   */
  authorizedGithubRepo?: string;
  /** 配置目录，测试用；线上走 resolveLocalDataDir()。 */
  dataDir?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/** readOnly 只用于界面上的审计标签：管理动作本身不算外部数据调用。 */
export type McpManageOutcome = { readOnly: boolean; result: Record<string, unknown> };

function normalizeAction(value: unknown): McpAdminAction {
  const action = String(value || '').trim().toLowerCase();
  if (!action) return 'list';
  if (!(MCP_ADMIN_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`不支持的动作「${action}」；可用：${MCP_ADMIN_ACTIONS.join(' / ')}`);
  }
  return action as McpAdminAction;
}

function findServer(idOrName: unknown, dataDir?: string): McpServerConfig {
  const key = String(idOrName || '').trim().toLowerCase();
  if (!key) throw new Error('需要提供 MCP 服务的 id 或名称；先用 action=list 看现有服务。');
  const normalized = normalizeMcpServerId(key);
  const target = listMcpServers({ dataDir }).find((server) => server.id === key || server.id === normalized || server.name.toLowerCase() === key);
  if (!target) throw new Error(`没有找到 MCP 服务「${key}」；先用 action=list 看现有服务。`);
  return target;
}

/** 工具描述来自外部服务：截断后只当资料带回，不构成可用性承诺。 */
function summarizeTool(server: McpServerConfig, tool: McpRemoteTool) {
  const allowed = new Set(server.enabledTools || []);
  const oversized = isMcpToolSchemaTooLarge(tool);
  return {
    name: tool.name,
    description: String(tool.description || tool.title || '').trim().slice(0, TOOL_DESCRIPTION_CHARS),
    readOnly: tool.annotations?.readOnlyHint === true,
    oversized,
    enabled: (!allowed.size || allowed.has(tool.name)) && !oversized,
  };
}

function savedNote(action: 'add' | 'update', saved: McpServerConfig, writeDenied: boolean) {
  return [
    action === 'add' ? '服务已保存。' : '服务配置已更新。',
    // 工具表在下一轮请求里才会重新拉取：本轮已经下发给模型的工具集不补发。
    '它的工具会在下一轮对话（下一次请求）才可用。',
    saved.allowWrite ? '' : '「允许写入」处于关闭状态，只有只读工具会被放行。',
    writeDenied ? '用户这一轮没有明确同意开启写入权限，这次没有打开；需要时先向用户确认。' : '',
  ].filter(Boolean).join(' ');
}

/** 执行一个管理动作；抛错表示没做成，调用方把 message 原样回给模型即可。 */
export async function runMcpManageAction(args: unknown, options: McpManageOptions = {}): Promise<McpManageOutcome> {
  const input = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  const action = normalizeAction(input.action);
  const { dataDir, fetchImpl } = options;
  const instruction = String(options.instruction || '');
  const writeGranted = WRITE_GRANT_PATTERN.test(instruction);

  if (action === 'list') {
    return {
      readOnly: true,
      result: {
        ok: true,
        action,
        servers: listMcpServers({ dataDir }).map(redactMcpServer),
        limit: MCP_MAX_SERVERS,
        note: '这是本机已配置的服务清单；它们公布的工具以 <serverId>__<toolName> 的名字暴露给你。',
      },
    };
  }

  if (action === 'probe') {
    const server = findServer(input.id || input.name, dataDir);
    const probed = await probeMcpServer(server, { fetchImpl, retry: true, timeouts: { init: PROBE_TIMEOUT_MS, list: PROBE_TIMEOUT_MS } });
    return {
      readOnly: true,
      result: {
        ok: true,
        action,
        server: redactMcpServer(server),
        readOnlyCount: probed.readOnly,
        tools: probed.tools.map((tool) => summarizeTool(server, tool)),
        note: '工具名和描述来自外部服务，只作资料参考。',
      },
    };
  }

  if (action === 'install_from_repo') {
    if (listMcpServers({ dataDir }).length >= MCP_MAX_SERVERS) throw new Error(`最多添加 ${MCP_MAX_SERVERS} 个 MCP 服务`);
    const repo = String(input.repo || input.url || '').trim();
    const requested = String(options.authorizedGithubRepo || '').trim() || parseGithubRepoFromInstruction(instruction);
    const repoIdentity = repo.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git(?:\/.*)?$/, '').replace(/\/.*$/, '').toLowerCase();
    const requestedIdentity = requested.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/, '').toLowerCase();
    if (!repo || !requested || repoIdentity !== requestedIdentity) {
      throw new Error('请把 GitHub 仓库地址直接发给我，我只会安装你这次消息里提供的仓库。');
    }
    const installed = await installGithubMcpFromRepo(repo, { dataDir, signal: options.signal });
    clearMcpToolCache(installed.server.id);
    resetMcpSessions(installed.server.url);
    const probed = await probeMcpServer(installed.server, { retry: true, timeouts: { init: PROBE_TIMEOUT_MS, list: PROBE_TIMEOUT_MS } });
    return {
      readOnly: false,
      result: {
        ok: true,
        action,
        server: redactMcpServer(installed.server),
        toolCount: probed.tools.length,
        readOnlyCount: probed.readOnly,
        note: `已安装并接入「${installed.server.name}」，默认只读；工具会在下一轮对话可用。`,
      },
    };
  }

  if (action === 'add') {
    if (listMcpServers({ dataDir }).length >= MCP_MAX_SERVERS) throw new Error(`最多添加 ${MCP_MAX_SERVERS} 个 MCP 服务`);
    // 内置连接器（GitHub / Context7）的配置只能由面板的连接流程写：那个 id 被这个工具占掉的话，
    // 用户手里的连接器会被换成一个由模型决定的地址和请求头。
    const wanted = normalizeMcpServerId(input.id || input.name || '');
    if (findCatalogEntry(wanted)) throw new Error(`「${wanted}」是内置连接器的 id，不能通过这个工具添加或覆盖；需要连接请让用户在 MCP 面板里操作。`);
    const writeDenied = input.allowWrite === true && !writeGranted;
    const saved = upsertMcpServer({
      id: input.id,
      name: input.name,
      url: input.url,
      headers: input.headers,
      allowWrite: input.allowWrite === true && writeGranted,
      enabled: input.enabled === undefined ? true : input.enabled,
      enabledTools: input.enabledTools,
    }, { dataDir });
    clearMcpToolCache(saved.id);
    resetMcpSessions(saved.url);
    return {
      readOnly: false,
      result: { ok: true, action, server: redactMcpServer(saved), note: savedNote('add', saved, writeDenied) },
    };
  }

  if (action === 'update') {
    const server = findServer(input.id || input.name, dataDir);
    // 连接器的权限、白名单和凭据都在面板里管：这里改会出现「本机放行、服务端仍旧只读」
    // 这类对不上的状态，写权限分项也只在面板里存在，模型自己打开等于绕过用户。
    if (server.catalogId) {
      if (typeof input.allowWrite === 'boolean' && input.allowWrite !== server.allowWrite) {
        throw new Error(`「${server.name}」是内置连接器，写入权限要在 MCP 面板里改（连接器 → 允许写入 → 写权限分项）。`);
      }
      if (input.enabledTools !== undefined) throw new Error(`「${server.name}」的工具清单由内置目录维护，不能通过这个工具改。`);
    }
    const writeDenied = input.allowWrite === true && !writeGranted;
    const patch: { enabled?: boolean; allowWrite?: boolean; enabledTools?: unknown; lazy?: boolean } = {};
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
    if (typeof input.lazy === 'boolean') patch.lazy = input.lazy;
    if (typeof input.allowWrite === 'boolean') patch.allowWrite = input.allowWrite && writeGranted;
    if (input.enabledTools !== undefined) patch.enabledTools = input.enabledTools;
    const saved = patchMcpServer(server.id, patch, { dataDir });
    if (!saved) throw new Error(`没有找到 MCP 服务「${server.id}」`);
    clearMcpToolCache(saved.id);
    resetMcpSessions(saved.url);
    return {
      readOnly: false,
      result: { ok: true, action, server: redactMcpServer(saved), note: savedNote('update', saved, writeDenied) },
    };
  }

  const server = findServer(input.id || input.name, dataDir);
  // 断开连接器会连带删掉本机保存的凭据，只能由用户在面板里点。
  if (server.catalogId) throw new Error(`「${server.name}」是内置连接器，需要断开请让用户在 MCP 面板里点「断开」。`);
  if (!REMOVE_GRANT_PATTERN.test(instruction)) {
    throw new Error(`用户这一轮没有明确要求移除「${server.name}」，先向用户确认再执行。`);
  }
  const removed = removeMcpServer(server.id, { dataDir });
  clearMcpToolCache(server.id);
  resetMcpSessions(server.url);
  return {
    readOnly: false,
    result: { ok: true, action: 'remove', id: server.id, removed, note: removed ? '服务已从本机配置里移除。' : '服务已经不存在。' },
  };
}

function parseGithubRepoFromInstruction(value: string) {
  const match = value.match(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/i);
  return match?.[0] || '';
}

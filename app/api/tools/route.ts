import { isAdminRequest } from '@/lib/auth';
import {
  MCP_CATALOG_ENTRIES,
  catalogEntryAccount,
  catalogEntryAllowWrite,
  catalogEntryEnabled,
  catalogEntryError,
  catalogEntryToolsets,
  catalogEntryWriteGates,
  findCatalogEntry,
  isRemoteCatalogEntry,
  isStdioCatalogEntry,
  requireStdioCatalogEntry,
  setCatalogEntryAllowWrite,
  setCatalogEntryWriteGate,
} from '@/lib/mcp/catalog';
import {
  catalogEntryState,
  configureRemoteCatalogEntry,
  connectRemoteCatalogEntry,
  disconnectRemoteCatalogEntry,
  findRemoteCatalogServer,
  isCatalogEntryConnecting,
  setRemoteCatalogToolset,
} from '@/lib/mcp/catalog-remote';
import {
  MCP_CATALOG_INSTALL_TIMEOUT_MS,
  cancelCatalogInstall,
  catalogRuntimeStatus,
  installCatalogServer,
  startCatalogServer,
  stopCatalogServer,
  type McpCatalogRuntimeStatus,
} from '@/lib/mcp/catalog-runtime';
import { addFilesystemRoot, listFilesystemRoots, removeFilesystemRoot, suggestFilesystemRoots } from '@/lib/mcp/filesystem-roots';
import { listMcpServers, redactMcpServer } from '@/lib/mcp/store';
import { closeStdioServer } from '@/lib/mcp/stdio';
import { clearMcpToolCache } from '@/lib/mcp/tools';

export const runtime = 'nodejs';

/**
 * 允许的动作写死在服务端：请求体只能选其中之一，带不了命令、参数或安装路径。
 * 本机运行时（stdio）是安装/启停，远端连接器（http）是连接/断开/配置。
 */
const TOOL_ACTIONS = ['install', 'start', 'stop', 'cancel', 'connect', 'disconnect', 'configure', 'allow-write', 'toolset', 'write-gate', 'roots-add', 'roots-remove'] as const;

function snapshot() {
  // 授权目录整份只读一次：同一个响应里的运行时状态和条目状态必须来自同一份授权清单。
  const roots = listFilesystemRoots();
  const runtimes: McpCatalogRuntimeStatus[] = [];
  for (const entry of MCP_CATALOG_ENTRIES) {
    if (!isStdioCatalogEntry(entry)) continue;
    try {
      runtimes.push(catalogRuntimeStatus(entry.id, { roots }));
    } catch {
      // 单个条目取不到状态不该让整个面板打不开。
    }
  }
  const servers = listMcpServers().map(redactMcpServer);
  const catalog = MCP_CATALOG_ENTRIES.map((entry) => {
    const runtime = runtimes.find((item) => item.id === entry.id);
    const config = servers.find((item) => item.id === entry.id);
    return {
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      publisher: entry.publisher,
      homepage: entry.homepage,
      transport: entry.transport,
      installMode: entry.installMode,
      trust: entry.trust,
      capabilities: [...entry.capabilities],
      permissions: [...entry.permissions],
      defaultReadOnly: entry.defaultReadOnly,
      setup: entry.setup,
      version: entry.version || '',
      installNote: entry.installNote || '',
      needsBrowser: isStdioCatalogEntry(entry) ? entry.needsBrowser : false,
      allowedTools: entry.allowedTools.length,
      allowWrite: catalogEntryAllowWrite(entry.id),
      enabled: catalogEntryEnabled(entry.id),
      needsRoots: isStdioCatalogEntry(entry) && entry.requiresRoots === true,
      state: catalogEntryState(entry, { runtime, roots }),
      /** 状态之外的「还差什么」：面板直接显示这句话，不让用户去猜为什么点不动。 */
      blockedReason: isStdioCatalogEntry(entry) && entry.requiresRoots && !roots.length ? '先在下面添加一个授权文件夹，这个服务才知道能读哪里' : '',
      connecting: isCatalogEntryConnecting(entry.id),
      error: catalogEntryError(entry.id),
      /** 连上之后问到的账号名：面板显示「连的是谁」，空字符串表示还没问到。 */
      account: catalogEntryAccount(entry.id),
      // 凭据只回「配没配」和去哪儿申请，值永远不出服务端。
      auth: {
        required: entry.setup.requiresAuth,
        optional: entry.auth?.optional === true,
        label: entry.auth?.label || '',
        helpUrl: entry.auth?.helpUrl || '',
        note: entry.auth?.note || '',
        configured: Boolean(config?.hasHeaders),
      },
      // 远端条目的可选项：能力组（toolsets）与写权限分项。写权限项打平成一维，
      // 面板只关心「有哪几项、哪几项是开的」。
      toolsets: (entry.toolsets || []).map((toolset) => ({
        id: toolset.id,
        label: toolset.label,
        summary: toolset.summary || '',
        writes: (toolset.writes || []).map((gate) => ({ id: gate.id, label: gate.label })),
      })),
      enabledToolsets: catalogEntryToolsets(entry.id),
      writeGates: (entry.toolsets || []).flatMap((toolset) => (toolset.writes || []).map((gate) => ({ id: gate.id, label: gate.label }))),
      enabledWriteGates: catalogEntryWriteGates(entry.id),
    };
  });
  // 常用位置：主目录下的桌面 / 文档 / 下载。只做建议，加不加仍然由用户点。
  const rootSuggestions = suggestFilesystemRoots({ excluded: roots });
  return { runtimes, catalog, servers, roots, rootSuggestions, installTimeoutMs: MCP_CATALOG_INSTALL_TIMEOUT_MS };
}

/** 面板状态：本地工具运行时的安装/运行情况 + 官方连接器状态 + 用户自己配的远程服务（凭据只回键名）。 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return Response.json({ ok: true, ...snapshot() });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      id?: unknown;
      token?: unknown;
      /** 授权目录（roots-add / roots-remove 用）。 */
      path?: unknown;
      allowWrite?: unknown;
      enabled?: unknown;
      lazy?: unknown;
      enabledTools?: unknown;
      /** 能力组（toolset 动作用）：要开/关的组 id。 */
      toolset?: unknown;
      /** 写权限分项（write-gate 动作用）：要开/关的项 id。 */
      gate?: unknown;
    };
    const action = String(data?.action || '');
    if (!(TOOL_ACTIONS as readonly string[]).includes(action)) {
      return Response.json({ error: '未知动作，只支持安装、启动、停止、取消、连接、断开、配置和权限设置。' }, { status: 400 });
    }
    if (action === 'cancel') {
      cancelCatalogInstall(data?.id);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'roots-add' || action === 'roots-remove') {
      // 授权文件夹只能由用户在面板里维护：助手侧的管理工具不碰这份清单（任务书 §12/§42）。
      if (action === 'roots-add') addFilesystemRoot(data?.path);
      else removeFilesystemRoot(data?.path);
      // 启动参数变了：旧进程还带着上一份目录，先收掉；工具表也要重算。
      closeStdioServer('filesystem');
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'allow-write') {
      const entry = findCatalogEntry(data?.id);
      if (!entry) return Response.json({ error: `未知的本地服务：${String(data?.id || '')}` }, { status: 400 });
      const allowWrite = data?.allowWrite === true;
      setCatalogEntryAllowWrite(entry.id, allowWrite);
      // 写入权限决定哪些工具会上报：缓存必须丢掉，否则这一轮还是旧工具表。
      clearMcpToolCache();
      if (isRemoteCatalogEntry(entry) && findRemoteCatalogServer(entry)) {
        // 远端条目的写权限一半在服务端（x-mcp-readonly 请求头）：连同请求头改掉，
        // 否则会出现「本机放行、服务端仍然拒绝」这种对不上的状态。
        const connection = await configureRemoteCatalogEntry(entry, { allowWrite, retest: true });
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'toolset' || action === 'write-gate') {
      const entry = findCatalogEntry(data?.id);
      if (!entry || !isRemoteCatalogEntry(entry)) {
        return Response.json({ error: `${String(data?.id || '')} 不是远端连接器，能力组只有远端才有。` }, { status: 400 });
      }
      if (action === 'toolset') {
        // 能力组写在请求头上，要重连一次服务端才会按新的组公布工具。
        const connection = await setRemoteCatalogToolset(entry, data?.toolset, data?.enabled === true);
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      // 写权限分项只影响本机下发哪些写工具：不用重连，但工具表缓存要丢掉。
      setCatalogEntryWriteGate(entry.id, data?.gate, data?.enabled === true);
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'connect' || action === 'disconnect' || action === 'configure') {
      const entry = findCatalogEntry(data?.id);
      if (!entry || !isRemoteCatalogEntry(entry)) {
        return Response.json({ error: `${String(data?.id || '')} 不是远端连接器，远端才能连接。` }, { status: 400 });
      }
      if (action === 'disconnect') {
        disconnectRemoteCatalogEntry(entry);
        return Response.json({ ok: true, ...snapshot() });
      }
      if (action === 'connect') {
        const connection = await connectRemoteCatalogEntry(entry, { token: typeof data.token === 'string' ? data.token : '' });
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      const connection = await configureRemoteCatalogEntry(entry, {
        token: typeof data.token === 'string' ? data.token : '',
        allowWrite: typeof data.allowWrite === 'boolean' ? data.allowWrite : undefined,
        enabledTools: data.enabledTools,
        lazy: typeof data.lazy === 'boolean' ? data.lazy : undefined,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
      });
      return Response.json({ ok: true, connection, ...snapshot() });
    }
    // 剩下的三个动作都是本机运行时：id 必须是目录里的 stdio 条目。
    const entry = requireStdioCatalogEntry(data?.id);
    if (action === 'stop') {
      stopCatalogServer(entry.id);
      // 工具表变了：不清缓存，模型下一轮还会拿着已经停掉的工具继续规划。
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    const result = action === 'install'
      ? await installCatalogServer(entry.id)
      : await startCatalogServer(entry.id, { roots: listFilesystemRoots() });
    clearMcpToolCache();
    return Response.json({ ok: true, runtime: result, ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '工具运行时操作失败。' }, { status: 400 });
  }
}
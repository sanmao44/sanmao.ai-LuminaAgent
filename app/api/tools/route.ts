import { isAdminRequest } from '@/lib/auth';
import { MCP_CATALOG_ENTRIES } from '@/lib/mcp/catalog';
import {
  MCP_CATALOG_INSTALL_TIMEOUT_MS,
  cancelCatalogInstall,
  catalogRuntimeStatus,
  installCatalogServer,
  startCatalogServer,
  stopCatalogServer,
  type McpCatalogRuntimeStatus,
} from '@/lib/mcp/catalog-runtime';
import { listMcpServers, redactMcpServer } from '@/lib/mcp/store';
import { clearMcpToolCache } from '@/lib/mcp/tools';

export const runtime = 'nodejs';

/** 允许的动作写死在服务端：请求体只能选其中之一，带不了命令、参数或安装路径。 */
const TOOL_ACTIONS = ['install', 'start', 'stop', 'cancel'] as const;

function snapshot() {
  const runtimes: McpCatalogRuntimeStatus[] = [];
  for (const entry of MCP_CATALOG_ENTRIES) {
    try {
      runtimes.push(catalogRuntimeStatus(entry.id));
    } catch {
      // 单个条目取不到状态不该让整个面板打不开。
    }
  }
  return { runtimes, servers: listMcpServers().map(redactMcpServer), installTimeoutMs: MCP_CATALOG_INSTALL_TIMEOUT_MS };
}

/** 面板状态：本地工具运行时的安装/运行情况 + 用户自己配的远程服务（凭据只回键名）。 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return Response.json({ ok: true, ...snapshot() });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = (await request.json().catch(() => ({}))) as { action?: unknown; id?: unknown };
    const action = String(data?.action || '');
    if (!(TOOL_ACTIONS as readonly string[]).includes(action)) {
      return Response.json({ error: '未知动作，只支持安装、启动、停止和取消。' }, { status: 400 });
    }
    if (action === 'cancel') {
      cancelCatalogInstall(data?.id);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'stop') {
      stopCatalogServer(data?.id);
      // 工具表变了：不清缓存，模型下一轮还会拿着已经停掉的工具继续规划。
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    const runtime = action === 'install' ? await installCatalogServer(data?.id) : await startCatalogServer(data?.id);
    clearMcpToolCache();
    return Response.json({ ok: true, runtime, ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '工具运行时操作失败。' }, { status: 400 });
  }
}
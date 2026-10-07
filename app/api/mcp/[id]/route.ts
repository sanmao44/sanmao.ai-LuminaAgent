import { isAdminRequest } from '@/lib/auth';
import { resetMcpSessions } from '@/lib/mcp/client';
import { MCP_MAX_SERVERS, listMcpServers, normalizeMcpServerId, patchMcpServer, redactMcpServer, removeMcpServer } from '@/lib/mcp/store';
import { clearMcpToolCache } from '@/lib/mcp/tools';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function snapshot() {
  return { servers: listMcpServers().map(redactMcpServer), limit: MCP_MAX_SERVERS };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const data = await request.json().catch(() => ({}));
    const server = patchMcpServer(decode(id), data);
    if (!server) return Response.json({ error: 'MCP 服务不存在。' }, { status: 404 });
    // 开关和允许写入都会改变权限判定；地址或请求头改了还得让旧会话失效。
    clearMcpToolCache(server.id);
    resetMcpSessions(server.url);
    return Response.json({ ok: true, server: redactMcpServer(server), ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '更新 MCP 服务失败。' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const key = normalizeMcpServerId(decode(id));
    // 先记下地址：删掉配置后就没法从列表里找回它那条会话了。
    const target = listMcpServers().find((item) => item.id === key);
    clearMcpToolCache(key);
    if (target) resetMcpSessions(target.url);
    if (!removeMcpServer(key)) return Response.json({ error: 'MCP 服务不存在。' }, { status: 404 });
    return Response.json({ ok: true, ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '删除 MCP 服务失败。' }, { status: 400 });
  }
}

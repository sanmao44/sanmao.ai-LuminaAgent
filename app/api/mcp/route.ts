import { isAdminRequest } from '@/lib/auth';
import { resetMcpSessions } from '@/lib/mcp/client';
import { MCP_MAX_SERVERS, listMcpServers, redactMcpServer, upsertMcpServer } from '@/lib/mcp/store';
import { clearMcpToolCache } from '@/lib/mcp/tools';

export const runtime = 'nodejs';

/** 列表只回传脱敏配置：请求头的值永远不出服务端。 */
function snapshot() {
  return { servers: listMcpServers().map(redactMcpServer), limit: MCP_MAX_SERVERS };
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return Response.json({ ok: true, ...snapshot() });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = await request.json().catch(() => ({}));
    const server = upsertMcpServer(data);
    // 新增或改过配置后必须丢掉工具缓存与会话，否则这一分钟内模型看到的还是旧工具表，
    // 而且会拿着旧地址/旧凭据握手出来的会话继续用。
    clearMcpToolCache(server.id);
    resetMcpSessions(server.url);
    return Response.json({ ok: true, server: redactMcpServer(server), ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存 MCP 服务失败。' }, { status: 400 });
  }
}

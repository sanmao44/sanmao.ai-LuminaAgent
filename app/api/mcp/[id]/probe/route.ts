import { isAdminRequest } from '@/lib/auth';
import { probeMcpServer } from '@/lib/mcp/client';
import { MCP_MAX_TOOLS_PER_SERVER, listMcpServers, normalizeMcpServerId } from '@/lib/mcp/store';
import { isMcpToolSchemaTooLarge } from '@/lib/mcp/tools';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * 连接自检：按当前配置真的握一次手并列一次工具，把结果原样交给面板。
 * 这里只读不写，不会调用任何工具，所以关闭「允许写入」的服务也能自检。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const target = normalizeMcpServerId(decode(id));
  const server = listMcpServers().find((item) => item.id === target);
  if (!server) return Response.json({ error: 'MCP 服务不存在。' }, { status: 404 });
  try {
    const result = await probeMcpServer(server, { signal: AbortSignal.timeout(20_000), retry: true });
    const enabledTools = new Set(server.enabledTools || []);
    return Response.json({
      ok: true,
      toolCount: result.tools.length,
      readOnly: result.readOnly,
      limit: MCP_MAX_TOOLS_PER_SERVER,
      allowWrite: server.allowWrite,
      tools: result.tools.map((tool) => ({
        name: tool.name,
        title: String(tool.title || ''),
        description: String(tool.description || '').slice(0, 240),
        readOnly: tool.annotations?.readOnlyHint === true,
        // 参数结构超限的工具不会下发给模型，这里如实标出来，别让用户以为勾了就生效。
        oversized: isMcpToolSchemaTooLarge(tool),
        enabled: (!enabledTools.size || enabledTools.has(tool.name)) && !isMcpToolSchemaTooLarge(tool),
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '连接 MCP 服务失败。' }, { status: 400 });
  }
}

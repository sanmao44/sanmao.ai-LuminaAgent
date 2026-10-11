import { isAdminRequest } from '@/lib/auth';
import { clearMcpToolCache } from '@/lib/mcp/tools';
import { listMcpServers, normalizeMcpServerId, redactMcpServer } from '@/lib/mcp/store';
import { updateGithubMcpFromRepo } from '@/lib/mcp/repo-installer';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function findServer(id: string) {
  const target = normalizeMcpServerId(decode(id));
  return listMcpServers().find((server) => server.id === target);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const server = findServer(id);
  if (!server) return Response.json({ error: 'MCP 服务不存在。' }, { status: 404 });
  if (server.transport !== 'stdio' || !server.managedRepo) {
    return Response.json({ error: '只有从 GitHub 仓库安装的本地 MCP 支持更新。' }, { status: 400 });
  }
  try {
    const result = await updateGithubMcpFromRepo(server, { force: true, signal: AbortSignal.timeout(12 * 60_000) });
    if (result.updated) clearMcpToolCache(server.id);
    return Response.json({
      ok: true,
      updated: result.updated,
      latestCommit: result.latestCommit,
      checkedAt: result.checkedAt,
      server: redactMcpServer(result.server),
      servers: listMcpServers().map(redactMcpServer),
    });
  } catch (error) {
    const current = findServer(id);
    return Response.json({
      error: error instanceof Error ? error.message : 'GitHub MCP 更新失败。',
      ...(current ? { server: redactMcpServer(current) } : {}),
      servers: listMcpServers().map(redactMcpServer),
    }, { status: 400 });
  }
}

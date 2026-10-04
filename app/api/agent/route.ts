import { isTrustedAppRequest } from '@/lib/auth';
import { runAgentApplication } from '@/apps/api/agent-application';

export const runtime = 'nodejs';

/** HTTP transport boundary. Agent planning, capability orchestration, tool execution,
 * provider coordination and lifecycle ownership live in the API application entry. */
export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return runAgentApplication(request);
}

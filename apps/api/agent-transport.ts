import { isTrustedAppRequest } from '@/lib/auth';
import { runAgentApplication } from '@/apps/api/agent-application';
import { readAgentHttpInput } from '@/apps/api/agent-http-contract';

/** HTTP transport adapter: auth and wire parsing only. */
export async function handleAgentHttpRequest(request: Request): Promise<Response> {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return runAgentApplication(await readAgentHttpInput(request));
}

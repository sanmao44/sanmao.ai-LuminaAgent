import { isTrustedAppRequest } from '@/lib/auth';
import { runComposedAgentApplication } from '@/apps/api/agent-entrypoint';
import { readAgentHttpInput } from '@/apps/api/agent-http-contract';
import type { AgentApplicationOutput } from '@/apps/api/agent-application-contract';

/** HTTP transport adapter: auth and wire parsing only. */
export async function handleAgentHttpRequest(request: Request): Promise<Response> {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return serializeAgentApplicationOutput(await runComposedAgentApplication(await readAgentHttpInput(request)));
}

export function serializeAgentApplicationOutput(output: AgentApplicationOutput): Response {
  if (output.kind === 'stream') {
    return new Response(output.body, {
      status: output.status,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', ...output.headers },
    });
  }
  return Response.json(output.body, { status: output.status });
}

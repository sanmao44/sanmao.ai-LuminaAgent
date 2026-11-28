import { createHash } from 'node:crypto';
import { isTrustedAppRequest } from '@/lib/auth';
import { normalizeAgentRunId } from '@/lib/agent/progress';
import { startAgentAssistantRun, readAgentAssistantRun, controlAgentAssistantRun } from '@/apps/api/agent-entrypoint';
import { runComposedAgentApplication } from '@/apps/api/agent-entrypoint';
import { readAgentHttpInput } from '@/apps/api/agent-http-contract';
import type { AgentApplicationOutput } from '@/apps/api/agent-application-contract';
import type { AgentAssistantRunAction } from '@/packages/contracts/agent';
import { runComposedAgentApplication as runAgent } from '@/apps/api/agent-entrypoint';

/** HTTP transport adapter: auth and wire parsing only. */
function assistantRunOwner(request: Request) {
  // Persist only a one-way browser-session binding, never the raw admin cookie.
  return createHash('sha256').update(request.headers.get('cookie') || 'local-loopback-session').digest('hex');
}

const assistantRunActions = new Set<AgentAssistantRunAction>(['pause', 'resume', 'cancel']);

export async function handleAgentHttpRequest(request: Request): Promise<Response> {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const input = await readAgentHttpInput(request);
  if (input.body.managedRun !== true) return serializeAgentApplicationOutput(await runComposedAgentApplication(input));
  const runId = normalizeAgentRunId(input.body.runId);
  if (!runId) return Response.json({ error: '任务编号无效。' }, { status: 400 });
  const run = await startAgentAssistantRun(input, runId, assistantRunOwner(request), (runInput, execution) =>
    runAgent({ ...runInput, signal: execution.signal }, execution));
  return Response.json(run, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleAgentAssistantRunExecutionRequest(request: Request, rawId: string): Promise<Response> {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const runId = normalizeAgentRunId(rawId);
  if (!runId) return Response.json({ error: '任务编号无效。' }, { status: 400 });
  const owner = assistantRunOwner(request);
  if (request.method === 'GET') {
    const run = await readAgentAssistantRun(owner, runId);
    return run ? Response.json(run, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: '找不到这个任务。' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  if (!assistantRunActions.has(body.action as AgentAssistantRunAction)) return Response.json({ error: '任务操作无效。' }, { status: 400 });
  const run = await controlAgentAssistantRun(owner, runId, body.action as AgentAssistantRunAction);
  return run ? Response.json(run, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: '找不到这个任务。' }, { status: 404 });
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

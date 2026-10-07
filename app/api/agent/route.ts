import { handleAgentHttpRequest } from '@/apps/api/agent-transport';

export const runtime = 'nodejs';

/** HTTP transport boundary. Agent planning, capability orchestration, tool execution,
 * provider coordination and lifecycle ownership live in the API application entry. */
export async function POST(request: Request) {
  return handleAgentHttpRequest(request);
}

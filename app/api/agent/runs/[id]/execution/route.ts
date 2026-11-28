import { handleAgentAssistantRunExecutionRequest } from '@/apps/api/agent-transport';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAgentAssistantRunExecutionRequest(request, id);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAgentAssistantRunExecutionRequest(request, id);
}
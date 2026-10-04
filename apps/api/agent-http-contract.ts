export type AgentHttpInput = {
  body: Record<string, unknown>;
  signal: AbortSignal;
};

export async function readAgentHttpInput(request: Request): Promise<AgentHttpInput> {
  const body = await request.json();
  return { body: body && typeof body === 'object' ? body as Record<string, unknown> : {}, signal: request.signal };
}

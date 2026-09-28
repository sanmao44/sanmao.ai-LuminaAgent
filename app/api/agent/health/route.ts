import { getAgentModelHealthSnapshot } from '@/lib/agent/model-health';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ agentHealth: getAgentModelHealthSnapshot() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

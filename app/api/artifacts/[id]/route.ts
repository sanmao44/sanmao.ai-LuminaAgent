import { isTrustedAppRequest } from '@/lib/auth';
import { buildArtifactResponse } from '@/lib/artifacts/download';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  const { id } = await context.params;
  return buildArtifactResponse(String(id || ''));
}

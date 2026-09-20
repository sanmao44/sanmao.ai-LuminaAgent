import { isTrustedAppRequest } from '@/lib/auth';
import { buildArtifactResponse } from '@/lib/artifacts/download';
import { buildArtifactPreviewResponse } from '@/lib/artifacts/preview';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });
  const { id } = await context.params;
  // 预览走同一份产物：只有显式带 preview=1 才解析内容，默认仍然是原样下载。
  const url = new URL(request.url);
  if (url.searchParams.has('preview')) {
    return buildArtifactPreviewResponse(String(id || ''), { theme: url.searchParams.get('theme') || '' });
  }
  return buildArtifactResponse(String(id || ''));
}

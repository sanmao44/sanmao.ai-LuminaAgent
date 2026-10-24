import { isTrustedAppRequest } from '@/lib/auth';
import { fetchLocalSegmentationModelFile } from '@/lib/local-segmentation-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!isTrustedAppRequest(request)) return new Response('Unauthorized', { status: 401 });

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    const { path } = await context.params;
    return await fetchLocalSegmentationModelFile(path, { environment: process.env, signal });
  } catch {
    return Response.json({ error: '本地智能点选模型下载失败，请检查网络或代理设置' }, { status: 502 });
  }
}

import { ModelArtifactPreviewError } from '@/apps/api/model-artifact-preview-application';
import { openThreeDModelOutputPreview } from '@/apps/api/model-artifact-preview-composition';
import { ModelArtifactPreviewReadError } from '@/lib/model-artifact-preview-reader';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ taskId: string; outputIndex: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { taskId, outputIndex: rawIndex } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId) || !/^(0|[1-9]\d{0,2})$/.test(rawIndex)) {
    return Response.json({ error: '模型任务或结果序号无效。' }, { status: 400 });
  }
  try {
    const asset = await openThreeDModelOutputPreview(taskId, Number(rawIndex));
    return new Response(asset.body, {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Content-Length': String(asset.contentLength),
        'Content-Disposition': 'inline; filename="model.glb"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ModelArtifactPreviewError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'not-ready' ? 409 : 415;
      return Response.json({ error: error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof ModelArtifactPreviewReadError) {
      return Response.json({ error: error.message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: '模型文件暂时无法预览。' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import { preciselyTrimVideo } from '@/lib/video-trim-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('video-trim');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: '缺少视频文件。' }, { status: 400 });
    const output = await preciselyTrimVideo({
      file,
      startTime: Number(form.get('startTime')),
      endTime: Number(form.get('endTime')),
      playbackRate: Number(form.get('playbackRate')),
      muted: form.get('muted') === 'true',
    });
    return new Response(output, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(output.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '视频精确裁剪失败。' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}

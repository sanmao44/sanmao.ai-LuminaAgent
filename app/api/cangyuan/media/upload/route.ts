import { publishCangyuanMediaUpload } from '@/apps/api/cangyuan-media-upload-composition';
import { CANGYUAN_AUDIO_UPLOAD_MAX_BYTES, CANGYUAN_IMAGE_UPLOAD_MAX_BYTES, CANGYUAN_VIDEO_UPLOAD_MAX_BYTES, CangyuanMediaUploadInputError } from '@/apps/api/cangyuan-media-upload-application';
import { MalformedMultipartRequestError, MultipartBodyTooLargeError, readBoundedMultipartFormData } from '@/apps/api/multipart-upload-http';
import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import type { CangyuanMediaUploadKind } from '@/packages/contracts/cangyuan-media-upload';

export const runtime = 'nodejs';

const MAX_MULTIPART_BYTES = Math.max(CANGYUAN_IMAGE_UPLOAD_MAX_BYTES, CANGYUAN_AUDIO_UPLOAD_MAX_BYTES, CANGYUAN_VIDEO_UPLOAD_MAX_BYTES) + 128 * 1024;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });

  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('cangyuan-media-upload');
    const form = await readBoundedMultipartFormData(request, MAX_MULTIPART_BYTES);
    const file = form.get('file');
    const kind = form.get('kind');
    if (!(file instanceof File) || (kind !== 'audio' && kind !== 'image' && kind !== 'video')) {
      return Response.json({ error: '请提供受支持的媒体文件。' }, { status: 400 });
    }
    const maxBytes = kind === 'audio' ? CANGYUAN_AUDIO_UPLOAD_MAX_BYTES : kind === 'video' ? CANGYUAN_VIDEO_UPLOAD_MAX_BYTES : CANGYUAN_IMAGE_UPLOAD_MAX_BYTES;
    if (file.size > maxBytes) {
      const label = kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片';
      return Response.json({ error: `${label}不能超过 ${Math.round(maxBytes / 1024 / 1024)} MiB（本站上传限制）。` }, { status: 413 });
    }
    const result = await publishCangyuanMediaUpload({
      kind: kind as CangyuanMediaUploadKind,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MalformedMultipartRequestError) return Response.json({ error: '上传请求格式无效，请重新选择文件后重试。' }, { status: 400 });
    if (error instanceof MultipartBodyTooLargeError) return Response.json({ error: '上传请求超过本站媒体上传限制。' }, { status: 413 });
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    if (error instanceof CangyuanMediaUploadInputError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : '媒体上传失败。' }, { status: 502 });
  } finally {
    await releaseRuntimeRequest();
  }
}

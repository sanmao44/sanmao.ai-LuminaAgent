import { isTrustedAppRequest } from '@/lib/auth';
import { AUDIO_ATTACHMENT_MAX_BYTES, AudioAttachmentError } from './audio-attachment-application';
import { runAudioAttachmentUpload } from './audio-attachment-entrypoint';

export async function handleAudioAttachmentRequest(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > AUDIO_ATTACHMENT_MAX_BYTES + 1024 * 1024) {
    return Response.json({ error: '音频文件不能超过 50MB。' }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: '无法读取上传内容，请重试。' }, { status: 400 });
  }
  const entry = form.get('file');
  if (!(entry instanceof File)) return Response.json({ error: '请选择一个音频文件。' }, { status: 400 });
  if (entry.size > AUDIO_ATTACHMENT_MAX_BYTES) return Response.json({ error: '音频文件不能超过 50MB。' }, { status: 413 });
  try {
    const result = await runAudioAttachmentUpload({
      name: entry.name,
      mimeType: entry.type,
      data: new Uint8Array(await entry.arrayBuffer()),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AudioAttachmentError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : '音频上传失败。' }, { status: 500 });
  }
}

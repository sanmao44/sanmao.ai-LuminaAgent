import { AudioTranscriptionInputError, AUDIO_TRANSCRIPTION_MAX_BYTES } from './audio-transcription-application';
import { transcribeAudio } from './audio-transcription-composition';
import { MalformedMultipartRequestError, MultipartBodyTooLargeError, readBoundedMultipartFormData } from './multipart-upload-http';
import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

const MAX_MULTIPART_BYTES = AUDIO_TRANSCRIPTION_MAX_BYTES + 256 * 1024;

export async function handleAudioTranscriptionRequest(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('audio-transcription');
    const form = await readBoundedMultipartFormData(request, MAX_MULTIPART_BYTES);
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: '请选择一个音频文件。' }, { status: 400 });
    if (file.size > AUDIO_TRANSCRIPTION_MAX_BYTES) return Response.json({ error: '音频文件不能超过 50 MiB。' }, { status: 413 });
    const rawTemperature = form.get('temperature');
    const input = {
      modelId: form.get('modelId'),
      file: { name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      ...(form.has('language') ? { language: form.get('language') } : {}),
      ...(form.has('prompt') ? { prompt: form.get('prompt') } : {}),
      ...(form.has('responseFormat') ? { responseFormat: form.get('responseFormat') } : {}),
      ...(rawTemperature !== null ? { temperature: Number(rawTemperature) } : {}),
    };
    const result = await transcribeAudio(input, AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]));
    return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MalformedMultipartRequestError) return Response.json({ error: '上传请求格式无效，请重新选择音频文件。' }, { status: 400 });
    if (error instanceof MultipartBodyTooLargeError) return Response.json({ error: '音频文件不能超过 50 MiB。' }, { status: 413 });
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    if (error instanceof AudioTranscriptionInputError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : '音频转写失败。' }, { status: 502 });
  } finally {
    await releaseRuntimeRequest();
  }
}

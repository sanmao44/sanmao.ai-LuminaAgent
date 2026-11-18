import { AudioSynthesisInputError, AudioSynthesisUnavailableError, audioSynthesisFailureCode, audioSynthesisLogMetadata } from '@/apps/api/audio-synthesis-application';
import { synthesizeCanvasNarration, synthesizeSpeechPreview } from '@/apps/api/audio-synthesis-composition';
import { SPEECH_VOICE_PREVIEW_TEXT } from '@/packages/contracts/audio-synthesis';
import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import { finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { normalizeGenerationSource } from '@/lib/generation-source';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 24_000) return Response.json({ error: '配音请求内容过大。' }, { status: 413 });

  let releaseRuntimeRequest = async () => {};
  let logId: string | undefined;
  const startedAt = Date.now();
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('audio-synthesis');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: '配音请求格式无效。' }, { status: 400 });
    }
    const raw = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const prompt = typeof raw.text === 'string' ? raw.text.trim() : '';
    const preview = raw.preview === true;
    if (preview && prompt !== SPEECH_VOICE_PREVIEW_TEXT) {
      return Response.json({ error: '音色试听只支持固定短句。' }, { status: 400 });
    }
    const source = normalizeGenerationSource(raw.source, 'workspace');
    if (prompt && !preview) {
      const speechMetadata = audioSynthesisLogMetadata(raw);
      logId = await startGenerationLog({
        mode: 'audio',
        mediaKind: 'audio',
        taskKind: 'media',
        source,
        ...speechMetadata,
        projectId: typeof raw.projectId === 'string' ? raw.projectId.trim().slice(0, 160) || undefined : undefined,
        canvasId: typeof raw.canvasId === 'string' ? raw.canvasId.trim().slice(0, 160) || undefined : undefined,
        nodeId: typeof raw.nodeId === 'string' ? raw.nodeId.trim().slice(0, 160) || undefined : undefined,
      });
    }
    const timeout = AbortSignal.timeout(120_000);
    const signal = AbortSignal.any([request.signal, timeout]);
    const result = preview
      ? await synthesizeSpeechPreview(body, signal)
      : await synthesizeCanvasNarration(body, signal);
    if (logId) await finishGenerationLog(logId, {
      status: 'success',
      durationMs: Date.now() - startedAt,
      modelId: result.modelId,
      modelName: result.modelName,
      audioUrl: result.storageUrl,
      ...(result.storageError ? { storageError: result.storageError } : {}),
    }).catch(() => undefined);
    return new Response(Buffer.from(result.data), {
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.data.byteLength),
        'Cache-Control': 'no-store',
        'X-Audio-Extension': result.extension,
        'X-Audio-Engine': result.engine,
        ...(result.modelName ? { 'X-Audio-Model': result.modelName } : {}),
        ...(result.modelId ? { 'X-Audio-Model-Id': result.modelId } : {}),
        ...(result.storageUrl ? { 'X-Audio-Url': result.storageUrl } : {}),
        // HTTP headers are ByteString values; encode the user-visible Chinese
        // message and let the workspace decode it before displaying it.
        ...(result.storageError ? { 'X-Audio-Storage-Error': encodeURIComponent(result.storageError) } : {}),
        ...(logId ? { 'X-Audio-Log-Id': logId } : {}),
      },
    });
  } catch (error) {
    if (logId) await finishGenerationLog(logId, {
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : '配音生成失败。',
      ...(audioSynthesisFailureCode(error) ? { errorCode: audioSynthesisFailureCode(error) } : {}),
    }).catch(() => undefined);
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    if (error instanceof AudioSynthesisInputError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof AudioSynthesisUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    const message = error instanceof Error ? error.message : '配音生成失败，请稍后重试。';
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await releaseRuntimeRequest();
  }
}

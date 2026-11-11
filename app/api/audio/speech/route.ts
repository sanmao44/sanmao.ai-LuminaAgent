import { AudioSynthesisInputError, AudioSynthesisUnavailableError, audioSynthesisFailureCode, audioSynthesisLogMetadata } from '@/apps/api/audio-synthesis-application';
import { synthesizeCanvasNarration } from '@/apps/api/audio-synthesis-composition';
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
    const source = normalizeGenerationSource(raw.source, 'workspace');
    if (prompt) {
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
    const result = await synthesizeCanvasNarration(body, signal);
    if (logId) await finishGenerationLog(logId, {
      status: 'success',
      durationMs: Date.now() - startedAt,
      modelId: result.modelId,
      modelName: result.modelName,
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

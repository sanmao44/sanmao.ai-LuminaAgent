import { upscaleImage } from '@/lib/providers';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { resolveStoredImageReference } from '@/lib/image-storage';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { getPublicState, getRuntimeImageModelForCapability } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';
import { referenceRecordsForLog } from '@/lib/reference-images';
import { normalizeGenerationSource, type GenerationSource } from '@/lib/generation-source';
import { startCloudUpscale } from '@/lib/upscale-service';
import { isUpscaleModelId } from '@/lib/upscale-catalog';

export const runtime = 'nodejs';
export const maxDuration = 1800;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const startedAt = Date.now();
  let promptForLog = '';
  let sourceForLog: GenerationSource = 'workspace';
  let errorStatus = 502;
  let logId: string | undefined;
  const requestController = new AbortController();
  const abortFromClient = () => requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  if (request.signal.aborted) requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  try {
    const body = await request.json();
    sourceForLog = normalizeGenerationSource(body.source, 'workspace');
    promptForLog = String(body.prompt || '').trim() || 'Upscale this image';
    const reference = String(body.reference || '').trim();
    const referenceRecords = referenceRecordsForLog(body.referenceImages);
    if (!reference) { errorStatus = 400; throw new Error('请先选择一张需要超分的图片。'); }
    const publicState = await getPublicState();
    const resolvedReference = await resolveStoredImageReference(reference, publicState.settings.imageStoragePath);
    const requestedModel = String(body.model || 'auto').trim();
    const hasConnectedCloud = publicState.upscaleConnections.some((connection) => connection.connected);
    if (isUpscaleModelId(requestedModel) || (requestedModel === 'auto' && hasConnectedCloud)) {
      const cloud = await startCloudUpscale({
        reference,
        sourceImageId: String(body.sourceImageId || '').trim() || undefined,
        requestedModel,
        scale: body.scale,
        idempotencyKey: String(body.idempotencyKey || body.taskId || '').trim() || undefined,
      });
      const task = cloud.task;
      return Response.json({
        ok: true,
        taskId: task.id,
        status: task.status,
        images: task.localImageUrl ? [{ url: task.localImageUrl }] : [],
        sourceImageId: task.sourceImageId,
        model: { id: cloud.model.id, name: cloud.model.displayName, provider: cloud.model.providerName },
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const runtime = await getRuntimeImageModelForCapability(String(body.model || 'auto'), 'upscale');
    if (!runtime) { errorStatus = 400; throw new Error('没有可用的超分模型。请重新读取模型，并启用 SeedVR2-7B 或其他带“超分”标签的模型。'); }
    const size = String(body.size || '').trim().toLowerCase();
    if (!/^\d+x\d+$/.test(size)) { errorStatus = 400; throw new Error('SeedVR2 的 size 必须是 WIDTHxHEIGHT，例如 2048x2048。'); }
    const [width, height] = size.split('x').map(Number);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) { errorStatus = 400; throw new Error('目标尺寸无效，请使用正整数 WIDTHxHEIGHT。'); }
    const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : 42;
    const colorCorrection = ['wavelet', 'none'].includes(String(body.colorCorrection || '')) ? String(body.colorCorrection) : 'wavelet';
    const resizeMethod = String(body.resizeMethod || '') === 'bicubic' ? 'bicubic' : String(body.resizeMethod || '') === 'nearest' ? 'nearest' : 'lanczos';
    const longEdge = Math.max(width, height);
    const resolution = longEdge <= 1536 ? '1K' : longEdge <= 3072 ? '2K' : '4K';
    logId = await startGenerationLog({ mode: 'upscale', source: sourceForLog, prompt: promptForLog, modelId: runtime.model.id, modelName: runtime.model.displayName, providerName: runtime.provider.name, resolution, outputSize: `${width}×${height}`, count: 1, references: referenceRecords.length ? referenceRecords : undefined }, String(body.taskId || ''));
    const images = await upscaleImage(runtime.provider, runtime.model.rawId, { reference: resolvedReference, size, seed, colorCorrection, resizeMethod, prompt: String(body.prompt || '') }, requestController.signal);
    if (requestController.signal.aborted) throw requestController.signal.reason || new Error('GENERATION_CANCELLED');
    const providerFinishedAt = Date.now();
    const stored = await persistGenerationResult({ images, storagePath: publicState.settings.imageStoragePath, startedAt, providerFinishedAt, logId });
    return Response.json({ ok: true, images: stored.images, storagePath: stored.path, size, seed, colorCorrection, resizeMethod, model: { id: runtime.model.id, name: runtime.model.displayName, provider: runtime.provider.name } });
  } catch (error) {
    const cancelled = requestController.signal.aborted || (error instanceof Error && error.message === 'GENERATION_CANCELLED');
    const message = cancelled ? '任务已取消，已停止等待服务商返回' : error instanceof Error ? error.message : '图片超分失败。';
    const failure = { status: 'error' as const, mode: 'upscale' as const, source: sourceForLog, prompt: promptForLog, durationMs: Date.now() - startedAt, error: message };
    if (logId) await finishGenerationLog(logId, failure).catch(() => undefined); else await appendGenerationLog(failure).catch(() => undefined);
    return Response.json({ error: message }, { status: cancelled ? 499 : errorStatus });
  } finally {
    request.signal.removeEventListener('abort', abortFromClient);
  }
}

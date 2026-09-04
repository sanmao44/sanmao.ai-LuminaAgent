import { editImage } from '@/lib/providers';
import { resolveStoredImageReference } from '@/lib/image-storage';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { getPublicState, getRuntimeImageModelForCapability, markProviderCredentialFailure } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';
import { referenceRecordsForLog } from '@/lib/reference-images';
import { enforceLocalEditMask } from '@/lib/local-edit-composite';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';
export const maxDuration = 1800;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const startedAt = Date.now();
  let promptForLog = '';
  let aspectRatioForLog = '自动';
  let logId: string | undefined;
  let runtimeProviderId = '';
  const requestController = new AbortController();
  const abortFromClient = () => requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  let releaseRuntimeRequest = async () => {};
  if (request.signal.aborted) requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('image-edit');
    const body = await request.json();
    const prompt = String(body.prompt || '').trim();
    promptForLog = prompt;
    const references: string[] = Array.isArray(body.references) ? body.references.filter((v: unknown): v is string => typeof v === 'string').slice(0, 16) : [];
    const referenceRecords = referenceRecordsForLog(body.referenceImages);
    const mask = typeof body.mask === 'string' && body.mask.startsWith('data:image/png') ? body.mask : undefined;
    const outputFormat = ['png', 'jpeg', 'webp'].includes(String(body.outputFormat || '').toLowerCase()) ? String(body.outputFormat).toLowerCase() as 'png' | 'jpeg' | 'webp' : 'png';
    const responseFormat = ['url', 'b64_json'].includes(String(body.responseFormat || '').toLowerCase()) ? String(body.responseFormat).toLowerCase() as 'url' | 'b64_json' : undefined;
    const background = ['transparent', 'opaque'].includes(String(body.background || '').toLowerCase()) ? String(body.background).toLowerCase() as 'transparent' | 'opaque' : undefined;
    if (!prompt) return Response.json({ error: '请输入你想怎么修改图片。' }, { status: 400 });
    if (!references.length) return Response.json({ error: '请至少添加一张参考图。' }, { status: 400 });
    if (body.mask && !mask) return Response.json({ error: '局部编辑范围必须是 PNG 格式。' }, { status: 400 });
    const runtime = await getRuntimeImageModelForCapability(String(body.model || 'auto'), 'edit');
    if (!runtime) return Response.json({ error: '没有支持图片修改的可用模型。' }, { status: 400 });
    runtimeProviderId = runtime.provider.id;
    const publicState = await getPublicState();
    const storagePath = publicState.settings.imageStoragePath;
    const resolvedReferences = await Promise.all(references.map((reference) => resolveStoredImageReference(reference, storagePath)));
    const input = {
      prompt,
      references: resolvedReferences,
      aspectRatio: String(body.aspectRatio || '自动'),
      count: Number(body.count || 1),
      width: Number(body.width || 0),
      height: Number(body.height || 0),
      resolution: ['1K', '2K', '3K', '4K'].includes(String(body.resolution || '').toUpperCase()) ? String(body.resolution).toUpperCase() : undefined,
      quality: String(body.quality || '自动'),
      fidelity: body.fidelity === 'low' ? 'low' as const : 'high' as const,
      mask,
      outputFormat,
      responseFormat,
      background,
    };
    aspectRatioForLog = input.aspectRatio;
    logId = await startGenerationLog({ mode: 'edit', source: 'workspace', prompt, modelId: runtime.model.id, modelName: runtime.model.displayName, providerName: runtime.provider.name, aspectRatio: input.aspectRatio, resolution: input.resolution, outputSize: input.width && input.height ? `${input.width}×${input.height}` : undefined, count: input.count, references: referenceRecords.length ? referenceRecords : undefined }, String(body.taskId || ''));
    const providerImages = await editImage(runtime.provider, runtime.model.rawId, input, requestController.signal);
    const images = mask
      ? await enforceLocalEditMask(providerImages, resolvedReferences[0], mask, {
          storagePath,
          signal: requestController.signal,
        })
      : providerImages;
    if (requestController.signal.aborted) throw requestController.signal.reason || new Error('GENERATION_CANCELLED');
    const providerFinishedAt = Date.now();
    const stored = await persistGenerationResult({ images, storagePath, startedAt, providerFinishedAt, logId });
    return Response.json({ ok: true, images: stored.images, storagePath: stored.path, model: { id: runtime.model.id, name: runtime.model.displayName, provider: runtime.provider.name } });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) {
      return Response.json({ error: error.message, retryable: true }, { status: 409 });
    }
    const upstreamStatus = Number((error as Error & { providerStatus?: number; status?: number }).providerStatus || (error as Error & { status?: number }).status || 0);
    if (runtimeProviderId && (upstreamStatus === 401 || upstreamStatus === 403)) await markProviderCredentialFailure(runtimeProviderId).catch(() => undefined);
    const cancelled = requestController.signal.aborted || (error instanceof Error && error.message === 'GENERATION_CANCELLED');
    const message = cancelled ? '任务已取消，已停止等待服务商返回' : error instanceof Error ? error.message : '修改图片失败。';
    const failure = { status: 'error' as const, mode: 'edit' as const, source: 'workspace' as const, prompt: promptForLog, aspectRatio: aspectRatioForLog, durationMs: Date.now() - startedAt, error: message };
    if (logId) await finishGenerationLog(logId, failure).catch(() => undefined); else await appendGenerationLog(failure).catch(() => undefined);
    return Response.json({ error: message }, { status: cancelled ? 499 : 502 });
  } finally {
    await releaseRuntimeRequest();
    request.signal.removeEventListener('abort', abortFromClient);
  }
}

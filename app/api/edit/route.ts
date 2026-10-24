import { editImage, imageDownloadAuth, type ImageEditInput } from '@/lib/providers';
import { resolveStoredImageReference } from '@/lib/image-storage';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { getPublicState, getRuntimeImageModelCandidates, getRuntimeImageModelForCapability, markProviderCredentialFailure } from '@/lib/store';
import { isTrustedAppRequest } from '@/lib/auth';
import { referenceRecordsForLog } from '@/lib/reference-images';
import { enforceLocalEditMask } from '@/lib/local-edit-composite';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import { normalizeStarApiLandscapeImages, normalizeStarApiLandscapePrompt } from '@/lib/image-orientation';
import { invokeMediaModelCandidates } from '@/packages/model-runtime/media';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const runImageModelCandidates = invokeMediaModelCandidates;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const startedAt = Date.now();
  let promptForLog = '';
  let aspectRatioForLog = '自动';
  let logId: string | undefined;
  let runtimeProviderId = '';
  let storagePath = '';
  let providerImages: Array<{ url: string; revisedPrompt?: string }> = [];
  let providerFinishedAt = 0;
  let localMaskSubmitted = false;
  let clientTaskId = '';
  let downloadAuthForResult: ReturnType<typeof imageDownloadAuth> | undefined;
  const requestController = new AbortController();
  const abortFromClient = () => requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  let releaseRuntimeRequest = async () => {};
  if (request.signal.aborted) requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('image-edit');
    const body = await request.json();
    const requestedTaskId = String(body.taskId || '').trim();
    clientTaskId = /^[a-zA-Z0-9_-]{1,100}$/.test(requestedTaskId) ? requestedTaskId : '';
    const prompt = String(body.prompt || '').trim();
    promptForLog = prompt;
    const references: string[] = Array.isArray(body.references) ? body.references.filter((v: unknown): v is string => typeof v === 'string').slice(0, 16) : [];
    const referenceRecords = referenceRecordsForLog(body.referenceImages);
    const mask = typeof body.mask === 'string' && body.mask.startsWith('data:image/png') ? body.mask : undefined;
    localMaskSubmitted = Boolean(mask);
    const rawMoveGuide = typeof body.moveGuide === 'string' ? body.moveGuide.trim() : '';
    const outputFormat = ['png', 'jpeg', 'webp'].includes(String(body.outputFormat || '').toLowerCase()) ? String(body.outputFormat).toLowerCase() as 'png' | 'jpeg' | 'webp' : 'png';
    const responseFormat = ['url', 'b64_json'].includes(String(body.responseFormat || '').toLowerCase()) ? String(body.responseFormat).toLowerCase() as 'url' | 'b64_json' : undefined;
    const background = ['transparent', 'opaque'].includes(String(body.background || '').toLowerCase()) ? String(body.background).toLowerCase() as 'transparent' | 'opaque' : undefined;
    if (!prompt) return Response.json({ error: '请输入你想怎么修改图片。' }, { status: 400 });
    if (!references.length) return Response.json({ error: '请至少添加一张参考图。' }, { status: 400 });
    if (body.mask && !mask) return Response.json({ error: '局部编辑范围必须是 PNG 格式。' }, { status: 400 });
    if (rawMoveGuide && !mask) return Response.json({ error: '移动引导图需要同时提交局部编辑范围。' }, { status: 400 });
    const requestedModelId = String(body.model || 'auto');
    let runtime = await getRuntimeImageModelForCapability(requestedModelId, 'edit');
    if (!runtime) return Response.json({ error: '没有支持图片修改的可用模型。' }, { status: 400 });
    runtimeProviderId = runtime.provider.id;
    const sizeMode: 'system' | 'custom' | undefined = body.sizeMode === 'custom' ? 'custom' : body.sizeMode === 'system' ? 'system' : undefined;
    const requestAspectRatio = String(body.aspectRatio || '自动');
    const requestWidth = Number(body.width || 0);
    const requestHeight = Number(body.height || 0);
    const generationPrompt = normalizeStarApiLandscapePrompt(runtime.provider, runtime.model.rawId, prompt, {
      aspectRatio: requestAspectRatio,
      width: requestWidth,
      height: requestHeight,
      sizeMode,
    });
    promptForLog = generationPrompt;
    aspectRatioForLog = requestAspectRatio;
    logId = await startGenerationLog({
      mode: 'edit',
      source: 'workspace',
      prompt: generationPrompt,
      modelId: runtime.model.id,
      modelName: runtime.model.displayName,
      providerName: runtime.provider.name,
      aspectRatio: requestAspectRatio,
      resolution: ['1K', '2K', '3K', '4K'].includes(String(body.resolution || '').toUpperCase()) ? String(body.resolution).toUpperCase() : undefined,
      outputSize: requestWidth && requestHeight ? `${requestWidth}×${requestHeight}` : undefined,
      count: Number(body.count || 1),
      references: referenceRecords.length ? referenceRecords : undefined,
    }, clientTaskId);
    const publicState = await getPublicState();
    storagePath = publicState.settings.imageStoragePath || '';
    const resolvedReferences = await Promise.all(references.map((reference) => resolveStoredImageReference(reference, storagePath)));
    const moveGuide = rawMoveGuide ? await resolveStoredImageReference(rawMoveGuide, storagePath) : undefined;
    const providerReferences = moveGuide ? [moveGuide, ...resolvedReferences.slice(1)] : resolvedReferences;
    downloadAuthForResult = imageDownloadAuth(runtime.provider);
    const input: ImageEditInput = {
      prompt: generationPrompt,
      references: providerReferences,
      aspectRatio: requestAspectRatio,
      count: Number(body.count || 1),
      width: requestWidth,
      height: requestHeight,
      sizeMode,
      resolution: ['1K', '2K', '3K', '4K'].includes(String(body.resolution || '').toUpperCase()) ? String(body.resolution).toUpperCase() : undefined,
      quality: String(body.quality || '自动'),
      fidelity: body.fidelity === 'low' ? 'low' as const : 'high' as const,
      mask,
      outputFormat,
      responseFormat,
      background,
    };
    aspectRatioForLog = input.aspectRatio || '自动';
    providerImages = await runImageModelCandidates(
      runtime,
      // Do not retry ordinary failures. A configured alternative is considered
      // only after an explicit “model unsupported/not found” rejection.
      async () => getRuntimeImageModelCandidates('auto', 'edit'),
      async (candidate) => {
        runtime = candidate;
        runtimeProviderId = candidate.provider.id;
        downloadAuthForResult = imageDownloadAuth(candidate.provider);
        return editImage(candidate.provider, candidate.model.rawId, input, requestController.signal);
      },
      { allowFallbackBeforeProviderSubmission: requestedModelId === 'auto' },
    );
    const maskSafeImages = mask
      ? await enforceLocalEditMask(providerImages, resolvedReferences[0], mask, {
          storagePath,
          signal: requestController.signal,
        })
      : providerImages;
    if (!maskSafeImages.length) throw new Error('图片服务尚未返回可应用的结果，本轮任务未完成。');
    const images = await normalizeStarApiLandscapeImages(runtime.provider, runtime.model.rawId, input, maskSafeImages, requestController.signal);
    if (requestController.signal.aborted) throw requestController.signal.reason || new Error('GENERATION_CANCELLED');
    providerFinishedAt = Date.now();
    const stored = await persistGenerationResult({ images, storagePath, startedAt, providerFinishedAt, logId, downloadAuth: downloadAuthForResult });
    return Response.json({ ok: true, images: stored.images, storagePath: stored.path, model: { id: runtime.model.id, name: runtime.model.displayName, provider: runtime.provider.name } });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) {
      return Response.json({ error: error.message, retryable: true }, { status: 409 });
    }
    const upstreamStatus = Number((error as Error & { providerStatus?: number; status?: number }).providerStatus || (error as Error & { status?: number }).status || 0);
    if (runtimeProviderId && (upstreamStatus === 401 || upstreamStatus === 403)) await markProviderCredentialFailure(runtimeProviderId).catch(() => undefined);
    if (!localMaskSubmitted && providerImages.some((image) => Boolean(String(image.url || '').trim()))) {
      const postProcessError = error instanceof Error ? error.message : '图片后处理失败';
      const providerResult = await persistGenerationResult({
        images: providerImages,
        storagePath,
        startedAt,
        providerFinishedAt: providerFinishedAt || Date.now(),
        logId,
        downloadAuth: downloadAuthForResult,
      }).catch(() => ({ images: providerImages, path: storagePath, remoteFallbacks: [] }));
      return Response.json({ ok: true, images: providerResult.images, storagePath: providerResult.path, warning: `图片已生成，但本地后处理未完成：${postProcessError}` });
    }
    const cancelled = requestController.signal.aborted || (error instanceof Error && error.message === 'GENERATION_CANCELLED');
    const errorMessage = error instanceof Error ? error.message : '修改图片失败。';
    const message = cancelled
      ? '任务已取消，已停止等待服务商返回'
      : localMaskSubmitted && providerImages.some((image) => Boolean(String(image.url || '').trim()))
        ? `局部编辑后处理失败，未返回未受蒙版约束的图片：${errorMessage}`
        : errorMessage;
    const providerTask = error as Error & { providerAcceptedTask?: boolean; providerPossiblyAccepted?: boolean; providerTaskId?: string };
    const providerResultWithheld = localMaskSubmitted && providerImages.some((image) => Boolean(String(image.url || '').trim()));
    const providerPossiblyAccepted = providerResultWithheld || Boolean(providerTask.providerAcceptedTask || providerTask.providerPossiblyAccepted);
    const failure = {
      status: 'error' as const,
      mode: 'edit' as const,
      source: 'workspace' as const,
      prompt: promptForLog,
      aspectRatio: aspectRatioForLog,
      durationMs: Date.now() - startedAt,
      error: message,
      ...(clientTaskId ? { taskId: clientTaskId } : {}),
      ...(providerPossiblyAccepted ? {
        errorCode: providerResultWithheld ? 'edit_result_withheld' : 'provider_result_unconfirmed',
        providerTaskId: providerTask.providerTaskId,
      } : {}),
    };
    if (logId) await finishGenerationLog(logId, failure).catch(() => undefined); else await appendGenerationLog(failure).catch(() => undefined);
    return Response.json({
      error: message,
      ...(providerPossiblyAccepted ? {
        errorCode: providerResultWithheld ? 'edit_result_withheld' : 'provider_result_unconfirmed',
        providerPossiblyAccepted: true,
        ...(providerResultWithheld ? { providerResultWithheld: true } : {}),
        providerTaskId: providerTask.providerTaskId,
      } : {}),
    }, { status: cancelled ? 499 : 502 });
  } finally {
    await releaseRuntimeRequest();
    request.signal.removeEventListener('abort', abortFromClient);
  }
}

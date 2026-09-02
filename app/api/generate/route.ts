import { editImage, generateImage } from '@/lib/providers';
import { getPublicState, getRuntimeImageGenerationModel, getRuntimeImageModelForCapability, markProviderCredentialFailure } from '@/lib/store';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { buildAnglePayload, compileAngleTargetPrompt, effectiveAngle, normalizeAngleState } from '@/lib/angle-control';
import { renderAngleOutput } from '@/lib/angle-image';
import type { GeneratedImage } from '@/lib/types';
import { isTrustedAppRequest } from '@/lib/auth';
import { referenceRecordsForLog } from '@/lib/reference-images';
import { normalizeGenerationSource, type GenerationSource } from '@/lib/generation-source';
import { enforceLocalEditMask } from '@/lib/local-edit-composite';

export const runtime = 'nodejs';
export const maxDuration = 1800;

function readCameraNumber(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function readCamera(value: unknown, label = 'camera') {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const raw = value as Record<string, unknown>;
  const modelId = raw.modelId === undefined ? undefined : String(raw.modelId);
  if (raw.modelId !== undefined && !modelId) throw new Error(`${label}.modelId must not be empty`);
  return normalizeAngleState({
    yaw: readCameraNumber(raw.yaw, `${label}.yaw`),
    pitch: readCameraNumber(raw.pitch, `${label}.pitch`),
    roll: readCameraNumber(raw.roll, `${label}.roll`),
    subjectYaw: readCameraNumber(raw.subjectYaw, `${label}.subjectYaw`),
    focal: readCameraNumber(raw.focal, `${label}.focal`),
    distance: readCameraNumber(raw.distance, `${label}.distance`),
    frameX: readCameraNumber(raw.frameX, `${label}.frameX`),
    frameY: readCameraNumber(raw.frameY, `${label}.frameY`),
    compositionLock: raw.compositionLock === undefined ? undefined : Boolean(raw.compositionLock),
    modelId,
  });
}

function dataUrlBuffer(url: string) {
  const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

async function generatedImageBuffer(url: string, signal?: AbortSignal) {
  const embedded = dataUrlBuffer(url);
  if (embedded) return embedded;
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to read generated image for roll correction: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function normalizeAngleOutputSize(images: GeneratedImage[], width: number, height: number, roll: number, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  return Promise.all(images.map(async (image) => {
    const input = await generatedImageBuffer(image.url, signal);
    const output = await renderAngleOutput(input, targetWidth, targetHeight, roll);
    return { ...image, url: `data:image/png;base64,${output.toString('base64')}` };
  }));
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let promptForLog = '';
  let aspectRatioForLog = '自动';
  let resolutionForLog: string | undefined;
  let outputSizeForLog: string | undefined;
  let modeForLog: 'generate' | 'edit' = 'generate';
  let sourceForLog: GenerationSource = 'workspace';
  let logId: string | undefined;
  let runtimeProviderId = '';
  const startedAt = Date.now();
  const requestController = new AbortController();
  const abortFromClient = () => requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  if (request.signal.aborted) requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  try {
    const body = await request.json();
    sourceForLog = normalizeGenerationSource(body.source, 'workspace');
    const prompt = String(body.prompt || '').trim();
    let camera;
    let cameraStart;
    try {
      camera = readCamera(body.camera);
      cameraStart = readCamera(body.cameraStart, 'cameraStart');
    }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid camera parameters' }, { status: 400 }); }
    const angleNote = typeof body.angleNote === 'string' ? body.angleNote : '';
    const angleOutput = camera && Number(body.width) > 0 && Number(body.height) > 0
      ? { aspectRatio: String(body.aspectRatio || '自动'), width: Number(body.width), height: Number(body.height) }
      : undefined;
    const cameraPayload = camera ? buildAnglePayload(camera, undefined, cameraStart, angleOutput) : undefined;
    if (camera && body.angleGuide === true && !angleOutput) return Response.json({ error: '3D 构图导引必须提供有效的输出宽高。' }, { status: 400 });
    const generationPrompt = camera
      ? compileAngleTargetPrompt(angleNote, camera, { hasGuideReference: body.angleGuide === true, output: angleOutput, cameraStart })
      : prompt;
    promptForLog = generationPrompt;
    if (!generationPrompt) return Response.json({ error: '请输入生图描述。' }, { status: 400 });
    const references = Array.isArray(body.references)
      ? body.references.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, 16)
      : [];
    const hasEditInput = references.length > 0 || (typeof body.mask === 'string' && body.mask.trim().length > 0);
    const runtime = hasEditInput
      ? await getRuntimeImageModelForCapability(String(body.model || 'auto'), 'edit') || await getRuntimeImageModelForCapability('auto', 'edit')
      : await getRuntimeImageGenerationModel(String(body.model || 'auto'));
    if (!runtime) return Response.json({ error: hasEditInput ? '没有可用的改图模型，请启用带 edit 能力的图片模型' : '没有可用的生图模型。请先到“模型库”勾选一个图片模型。' }, { status: 400 });
    runtimeProviderId = runtime.provider.id;
    const referenceRecords = referenceRecordsForLog(body.referenceImages);
    if (camera && body.angleGuide === true && references.length !== 2) return Response.json({ error: '角度控制台必须按顺序提交两张参考图：原始人物参考和 3D 构图导引。' }, { status: 400 });
    const rawMask = typeof body.mask === 'string' ? body.mask.trim() : '';
    const mask = rawMask.startsWith('data:image/png') ? rawMask : undefined;
    if (rawMask && !mask) return Response.json({ error: '局部编辑范围必须是 PNG 格式。' }, { status: 400 });
    if (mask && !references.length) return Response.json({ error: '使用局部编辑前请先添加一张参考图。' }, { status: 400 });
    const outputFormat = ['png', 'jpeg', 'webp'].includes(String(body.outputFormat || '').toLowerCase()) ? String(body.outputFormat).toLowerCase() as 'png' | 'jpeg' | 'webp' : 'png';
    const responseFormat = ['url', 'b64_json'].includes(String(body.responseFormat || '').toLowerCase()) ? String(body.responseFormat).toLowerCase() as 'url' | 'b64_json' : undefined;
    const background = ['transparent', 'opaque'].includes(String(body.background || '').toLowerCase()) ? String(body.background).toLowerCase() as 'transparent' | 'opaque' : undefined;
    const input = {
      prompt: generationPrompt,
      aspectRatio: String(body.aspectRatio || '自动'),
      count: Number(body.count || 1),
      width: Number(body.width || 0),
      height: Number(body.height || 0),
      quality: String(body.quality || '自动'),
      resolution: ['1K', '2K', '3K', '4K'].includes(String(body.resolution || '').toUpperCase()) ? String(body.resolution).toUpperCase() : undefined,
      outputFormat,
      responseFormat,
      background,
    };
    aspectRatioForLog = input.aspectRatio;
    resolutionForLog = input.resolution;
    outputSizeForLog = input.width && input.height ? `${input.width}×${input.height}` : undefined;
    modeForLog = references.length ? 'edit' : 'generate';
    logId = await startGenerationLog({ mode: modeForLog, source: sourceForLog, prompt: generationPrompt, modelId: runtime.model.id, modelName: runtime.model.displayName, providerName: runtime.provider.name, aspectRatio: aspectRatioForLog, resolution: resolutionForLog, outputSize: outputSizeForLog, count: input.count, angle: cameraPayload, references: referenceRecords.length ? referenceRecords : undefined }, String(body.taskId || ''));
    const providerImages = references.length
      ? await editImage(runtime.provider, runtime.model.rawId, { ...input, references, mask, fidelity: camera ? 'low' : body.fidelity === 'low' ? 'low' : 'high' }, requestController.signal)
      : await generateImage(runtime.provider, runtime.model.rawId, input, requestController.signal);
    const normalizedImages = camera && angleOutput
      ? await normalizeAngleOutputSize(providerImages, angleOutput.width, angleOutput.height, effectiveAngle(camera.roll), requestController.signal)
      : providerImages;
    if (requestController.signal.aborted) throw requestController.signal.reason || new Error('GENERATION_CANCELLED');
    const providerFinishedAt = Date.now();
    const storagePath = (await getPublicState()).settings.imageStoragePath;
    const generatedImages = mask
      ? await enforceLocalEditMask(normalizedImages, references[0], mask, {
          storagePath,
          signal: requestController.signal,
        })
      : normalizedImages;
    const stored = await persistGenerationResult({ images: generatedImages, storagePath, startedAt, providerFinishedAt, logId });
    return Response.json({ ok: true, images: stored.images, mode: references.length ? 'reference' : 'generate', model: { id: runtime.model.id, name: runtime.model.displayName, provider: runtime.provider.name }, camera: cameraPayload, storagePath: stored.path });
  } catch (error) {
    const upstreamStatus = Number((error as Error & { providerStatus?: number; status?: number }).providerStatus || (error as Error & { status?: number }).status || 0);
    if (runtimeProviderId && (upstreamStatus === 401 || upstreamStatus === 403)) await markProviderCredentialFailure(runtimeProviderId).catch(() => undefined);
    const cancelled = requestController.signal.aborted || (error instanceof Error && error.message === 'GENERATION_CANCELLED');
    const failure = { status: 'error' as const, mode: modeForLog, source: sourceForLog, prompt: promptForLog, aspectRatio: aspectRatioForLog, resolution: resolutionForLog, outputSize: outputSizeForLog, durationMs: Date.now() - startedAt, error: cancelled ? '任务已取消，已停止等待服务商返回' : error instanceof Error ? error.message : '生图失败' };
    if (logId) await finishGenerationLog(logId, failure).catch(() => undefined); else await appendGenerationLog(failure).catch(() => undefined);
    return Response.json({ error: failure.error }, { status: cancelled ? 499 : 502 });
  } finally {
    request.signal.removeEventListener('abort', abortFromClient);
  }
}

import { editImage, generateImage } from '@/lib/providers';
import { getPublicState, getRuntimeImageGenerationModel } from '@/lib/store';
import { appendGenerationLog, finishGenerationLog, startGenerationLog } from '@/lib/generation-log';
import { persistGenerationResult } from '@/lib/generation-persistence';
import { buildAnglePayload, compileAngleTargetPrompt, effectiveAngle, normalizeAngleState } from '@/lib/angle-control';
import type { GeneratedImage } from '@/lib/types';
import sharp from 'sharp';
import { isTrustedAppRequest } from '@/lib/auth';

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

async function applyExactCameraRoll(images: GeneratedImage[], roll: number, signal?: AbortSignal): Promise<GeneratedImage[]> {
  if (Math.abs(roll) < 0.05) return images;
  return Promise.all(images.map(async (image) => {
    const input = await generatedImageBuffer(image.url, signal);
    const normalized = await sharp(input, { failOn: 'none' }).rotate().png().toBuffer({ resolveWithObject: true });
    const width = normalized.info.width;
    const height = normalized.info.height;
    if (!width || !height) return image;
    const radians = Math.abs(roll) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const scale = Math.max(cosine + (height / width) * sine, cosine + (width / height) * sine) + 0.01;
    const scaledWidth = Math.max(width, Math.ceil(width * scale));
    const scaledHeight = Math.max(height, Math.ceil(height * scale));
    // Do not scale the actual image before rotating it: doing so turns a
    // modest roll into a severe zoom/crop and commonly removes a face or
    // head.  A blurred, enlarged backdrop fills the corners while the
    // unscaled source stays centered above it.
    const backdrop = await sharp(normalized.data)
      .resize(scaledWidth, scaledHeight, { fit: 'fill' })
      .blur(12)
      .rotate(roll, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const backdropLeft = Math.max(0, Math.floor(((backdrop.info.width || width) - width) / 2));
    const backdropTop = Math.max(0, Math.floor(((backdrop.info.height || height) - height) / 2));
    const base = await sharp(backdrop.data).extract({ left: backdropLeft, top: backdropTop, width, height }).png().toBuffer();

    const foreground = await sharp(normalized.data)
      .rotate(roll, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const foregroundWidth = foreground.info.width || width;
    const foregroundHeight = foreground.info.height || height;
    const foregroundLeft = Math.floor((width - foregroundWidth) / 2);
    const foregroundTop = Math.floor((height - foregroundHeight) / 2);
    const visibleLeft = Math.max(0, foregroundLeft);
    const visibleTop = Math.max(0, foregroundTop);
    const cropLeft = Math.max(0, -foregroundLeft);
    const cropTop = Math.max(0, -foregroundTop);
    const visibleWidth = Math.min(width - visibleLeft, foregroundWidth - cropLeft);
    const visibleHeight = Math.min(height - visibleTop, foregroundHeight - cropTop);
    const visibleForeground = await sharp(foreground.data)
      .extract({ left: cropLeft, top: cropTop, width: Math.max(1, visibleWidth), height: Math.max(1, visibleHeight) })
      .png()
      .toBuffer();
    const output = await sharp(base)
      .composite([{ input: visibleForeground, left: visibleLeft, top: visibleTop }])
      .png()
      .toBuffer();
    return { ...image, url: `data:image/png;base64,${output.toString('base64')}` };
  }));
}

async function normalizeAngleOutputSize(images: GeneratedImage[], width: number, height: number, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  return Promise.all(images.map(async (image) => {
    const input = await generatedImageBuffer(image.url, signal);
    const metadata = await sharp(input, { failOn: 'none' }).metadata();
    if (metadata.width === targetWidth && metadata.height === targetHeight) return image;
    const output = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
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
  let logId: string | undefined;
  const startedAt = Date.now();
  const requestController = new AbortController();
  const abortFromClient = () => requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  if (request.signal.aborted) requestController.abort(request.signal.reason || new Error('GENERATION_CANCELLED'));
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  try {
    const body = await request.json();
    const prompt = String(body.prompt || '').trim();
    let camera;
    let cameraStart;
    try {
      camera = readCamera(body.camera);
      cameraStart = readCamera(body.cameraStart, 'cameraStart');
    }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid camera parameters' }, { status: 400 }); }
    const cameraPayload = camera ? buildAnglePayload(camera, undefined, cameraStart) : undefined;
    const angleNote = typeof body.angleNote === 'string' ? body.angleNote : '';
    const angleOutput = camera && Number(body.width) > 0 && Number(body.height) > 0
      ? { aspectRatio: String(body.aspectRatio || '自动'), width: Number(body.width), height: Number(body.height) }
      : undefined;
    if (camera && body.angleGuide === true && !angleOutput) return Response.json({ error: '3D 构图导引必须提供有效的输出宽高。' }, { status: 400 });
    const generationPrompt = camera
      ? compileAngleTargetPrompt(angleNote, camera, { hasGuideReference: body.angleGuide === true, output: angleOutput, cameraStart })
      : prompt;
    promptForLog = generationPrompt;
    if (!generationPrompt) return Response.json({ error: '请输入生图描述。' }, { status: 400 });
    const runtime = await getRuntimeImageGenerationModel(String(body.model || 'auto'));
    if (!runtime) return Response.json({ error: '没有可用的生图模型。请先到“模型库”勾选一个图片模型。' }, { status: 400 });
    const references = Array.isArray(body.references) ? body.references.filter((v: unknown) => typeof v === 'string').slice(0, 16) : [];
    if (camera && body.angleGuide === true && references.length !== 2) return Response.json({ error: '角度控制台必须按顺序提交两张参考图：原始人物参考和 3D 构图导引。' }, { status: 400 });
    const mask = typeof body.mask === 'string' && body.mask.startsWith('data:image/png') ? body.mask : undefined;
    if (body.mask && !mask) return Response.json({ error: '蒙版必须是 PNG 格式。' }, { status: 400 });
    if (mask && !references.length) return Response.json({ error: '使用蒙版前请先添加一张参考图。' }, { status: 400 });
    const outputFormat = ['png', 'jpeg', 'webp'].includes(String(body.outputFormat || '').toLowerCase()) ? String(body.outputFormat).toLowerCase() as 'png' | 'jpeg' | 'webp' : 'png';
    const background = ['transparent', 'opaque'].includes(String(body.background || '').toLowerCase()) ? String(body.background).toLowerCase() as 'transparent' | 'opaque' : undefined;
    const input = {
      prompt: generationPrompt,
      aspectRatio: String(body.aspectRatio || '自动'),
      count: Number(body.count || 1),
      width: Number(body.width || 0),
      height: Number(body.height || 0),
      quality: String(body.quality || '自动'),
      resolution: ['1K', '2K', '4K'].includes(String(body.resolution || '').toUpperCase()) ? String(body.resolution).toUpperCase() : undefined,
      outputFormat,
      background,
    };
    aspectRatioForLog = input.aspectRatio;
    resolutionForLog = input.resolution;
    outputSizeForLog = input.width && input.height ? `${input.width}×${input.height}` : undefined;
    modeForLog = references.length ? 'edit' : 'generate';
    logId = await startGenerationLog({ mode: modeForLog, source: 'workspace', prompt: generationPrompt, modelId: runtime.model.id, modelName: runtime.model.displayName, providerName: runtime.provider.name, aspectRatio: aspectRatioForLog, resolution: resolutionForLog, outputSize: outputSizeForLog, count: input.count, angle: cameraPayload }, String(body.taskId || ''));
    const providerImages = references.length
      ? await editImage(runtime.provider, runtime.model.rawId, { ...input, references, mask, fidelity: camera ? 'low' : body.fidelity === 'low' ? 'low' : 'high' }, requestController.signal)
      : await generateImage(runtime.provider, runtime.model.rawId, input, requestController.signal);
    const rolledImages = camera ? await applyExactCameraRoll(providerImages, effectiveAngle(camera.roll), requestController.signal) : providerImages;
    const generatedImages = camera && angleOutput
      ? await normalizeAngleOutputSize(rolledImages, angleOutput.width, angleOutput.height, requestController.signal)
      : rolledImages;
    if (requestController.signal.aborted) throw requestController.signal.reason || new Error('GENERATION_CANCELLED');
    const providerFinishedAt = Date.now();
    const storagePath = (await getPublicState()).settings.imageStoragePath;
    const stored = await persistGenerationResult({ images: generatedImages, storagePath, startedAt, providerFinishedAt, logId });
    return Response.json({ ok: true, images: stored.images, mode: references.length ? 'reference' : 'generate', model: { id: runtime.model.id, name: runtime.model.displayName, provider: runtime.provider.name }, camera: cameraPayload, storagePath: stored.path });
  } catch (error) {
    const cancelled = requestController.signal.aborted || (error instanceof Error && error.message === 'GENERATION_CANCELLED');
    const failure = { status: 'error' as const, mode: modeForLog, source: 'workspace' as const, prompt: promptForLog, aspectRatio: aspectRatioForLog, resolution: resolutionForLog, outputSize: outputSizeForLog, durationMs: Date.now() - startedAt, error: cancelled ? '任务已取消，已停止等待服务商返回' : error instanceof Error ? error.message : '生图失败' };
    if (logId) await finishGenerationLog(logId, failure).catch(() => undefined); else await appendGenerationLog(failure).catch(() => undefined);
    return Response.json({ error: failure.error }, { status: cancelled ? 499 : 502 });
  } finally {
    request.signal.removeEventListener('abort', abortFromClient);
  }
}

import { createHash } from 'node:crypto';
import { preparePublicMediaUrl } from './signed-media';
import { persistImageBuffer } from './image-storage';
import { getPublicState, getUpscaleConnectionWithCredentials, setUpscaleConnectionStatus, type UpscaleConnectionCredentials } from './store';
import { getUpscaleCatalogModel, isUpscaleModelId, preferredUpscaleModelId } from './upscale-catalog';
import { prepareAliyunUpscaleImage } from './upscale-image';
import { createUpscaleProvider, isUpscaleProviderError, type UpscaleProviderError } from './upscale-providers';
import { createUpscaleTask, findUpscaleTask, updateUpscaleTask, type UpscaleTask } from './upscale-task-store';
import type { UpscaleModelId, UpscaleOutputFormat, UpscaleProviderId } from './types';

const activePolls = new Set<string>();
const TASK_TIMEOUT_MS = 20 * 60 * 1000;

export function scaleValue(value: unknown): 1 | 2 | 3 | 4 {
  const number = Number(value);
  return number === 1 || number === 3 || number === 4 ? number : 2;
}

export function pickUpscaleModel(requested: unknown, connectedProviders: Set<UpscaleProviderId>, hasLegacyModel = false): UpscaleModelId | null {
  if (isUpscaleModelId(requested)) return requested;
  const preferred = preferredUpscaleModelId(connectedProviders, hasLegacyModel);
  return preferred && preferred !== 'legacy' ? preferred as UpscaleModelId : null;
}

function idempotencyKey(sourceImageId: string, reference: string, model: string, scale: number, outputFormat?: UpscaleOutputFormat, outputQuality?: number) {
  return createHash('sha256').update(`${sourceImageId}\n${reference}\n${model}\n${scale}\n${outputFormat || ''}\n${outputQuality || ''}`).digest('hex');
}

function friendlyError(error: unknown) {
  if (isUpscaleProviderError(error)) return error;
  return error instanceof Error ? error : new Error('高清处理失败，请稍后重试。');
}

async function credentialsFor(provider: UpscaleProviderId) {
  const connection = await getUpscaleConnectionWithCredentials(provider);
  if (!connection) throw new Error(provider === 'tencent-ci' ? '请先连接腾讯云数据万象。' : '请先连接阿里云视觉智能开放平台。');
  if (connection.status !== 'healthy') throw new Error('云平台连接尚未通过验证，请先重新检测连接。');
  return connection;
}

function normalizeOutputFormat(value: unknown): UpscaleOutputFormat | undefined {
  return value === 'png' || value === 'jpg' || value === 'bmp' ? value : undefined;
}

function normalizeOutputQuality(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(30, Math.min(100, Math.round(number))) : undefined;
}

async function publicImageUrl(reference: string, provider: UpscaleProviderId, storagePath?: string) {
  if (provider === 'aliyun-viapi') {
    const prepared = await prepareAliyunUpscaleImage(reference, storagePath);
    return preparePublicMediaUrl(prepared.dataUrl, 'image');
  }
  return preparePublicMediaUrl(reference, 'image');
}

async function saveResult(task: UpscaleTask, result: { buffer: Buffer; mime: string }) {
  const state = await getPublicState();
  const saved = await persistImageBuffer(result.buffer, result.mime, state.settings.imageStoragePath);
  return updateUpscaleTask(task.id, {
    status: 'succeeded',
    localImageUrl: saved.url,
    completedAt: new Date().toISOString(),
    nextPollAt: undefined,
    error: undefined,
    errorCode: undefined,
  });
}

export async function startCloudUpscale(input: { reference: string; sourceImageId?: string; requestedModel?: unknown; scale?: unknown; outputFormat?: unknown; outputQuality?: unknown; idempotencyKey?: string }) {
  const state = await getPublicState();
  const connected = new Set(state.upscaleConnections.filter((connection) => connection.connected).map((connection) => connection.provider));
  const modelId = pickUpscaleModel(input.requestedModel, connected);
  if (!modelId) throw new Error('请先连接腾讯云或阿里云高清服务。');
  const model = getUpscaleCatalogModel(modelId);
  if (!model) throw new Error('高清模型不存在。');
  const scale = scaleValue(input.scale);
  if (!model.scales.includes(scale)) throw new Error(`${model.displayName} 不支持 ${scale}×，请选择其他倍率。`);
  const outputFormat = normalizeOutputFormat(input.outputFormat);
  const outputQuality = normalizeOutputQuality(input.outputQuality);
  if (outputFormat && !model.outputFormats?.includes(outputFormat)) throw new Error(`${model.displayName} 不支持 ${outputFormat.toUpperCase()} 输出。`);
  const sourceImageId = String(input.sourceImageId || 'unknown').slice(0, 300);
  const reference = String(input.reference || '').trim();
  if (!reference) throw new Error('请先选择一张需要超分的图片。');
  const connection = await credentialsFor(model.provider);
  const provider = createUpscaleProvider(model.provider, connection);
  const key = input.idempotencyKey || idempotencyKey(sourceImageId, reference, modelId, scale, outputFormat, outputQuality);
  const existing = (await createUpscaleTask({ provider: model.provider, model: modelId, scale, outputFormat, outputQuality, sourceImageId, status: 'processing', idempotencyKey: key })).task;
  if (existing.status === 'succeeded' || existing.status === 'queued' || existing.status === 'processing' && existing.providerTaskId) return { task: existing, model };
  const imageUrl = await publicImageUrl(reference, model.provider, state.settings.imageStoragePath);
  try {
    const result = await provider.upscale({ imageUrl, scale, modelId, outputFormat, outputQuality });
    if (result.status === 'succeeded') {
      const task = await saveResult(existing, result);
      return { task: task || existing, model };
    }
    const task = await updateUpscaleTask(existing.id, { status: result.status, providerTaskId: result.providerTaskId, nextPollAt: Date.now() + 1500, pollCount: 0 });
    return { task: task || existing, model };
  } catch (error) {
    const failure = friendlyError(error) as UpscaleProviderError;
    await updateUpscaleTask(existing.id, { status: 'failed', errorCode: isUpscaleProviderError(failure) ? failure.code : 'UPSTREAM_ERROR', error: failure.message, completedAt: new Date().toISOString() });
    if (isUpscaleProviderError(failure) && (failure.code === 'INVALID_CREDENTIAL' || failure.code === 'SIGNATURE_INVALID')) await setUpscaleConnectionStatus(model.provider, 'error', failure.code).catch(() => undefined);
    throw failure;
  }
}

export async function refreshUpscaleTask(id: string) {
  const task = await findUpscaleTask(id);
  if (!task || task.status === 'succeeded' || task.status === 'failed') return task;
  if (!task.providerTaskId) return task;
  if (task.nextPollAt && task.nextPollAt > Date.now()) return task;
  if (Date.parse(task.createdAt) + TASK_TIMEOUT_MS < Date.now()) {
    return updateUpscaleTask(id, { status: 'failed', errorCode: 'TASK_TIMEOUT', error: '高清处理时间较长，请稍后重试。', completedAt: new Date().toISOString() });
  }
  if (activePolls.has(id)) return task;
  activePolls.add(id);
  try {
    const credentials = await credentialsFor(task.provider);
    const provider = createUpscaleProvider(task.provider, credentials);
    if (!provider.poll) return task;
    const result = await provider.poll(task.providerTaskId, { modelId: task.model });
    if (result.status === 'succeeded') return await saveResult(task, result);
    return await updateUpscaleTask(id, { status: result.status, pollCount: task.pollCount + 1, nextPollAt: Date.now() + Math.min(15_000, 1500 + task.pollCount * 500) });
  } catch (error) {
    const failure = friendlyError(error) as UpscaleProviderError;
    const next = await updateUpscaleTask(id, { status: 'failed', errorCode: isUpscaleProviderError(failure) ? failure.code : 'UPSTREAM_ERROR', error: failure.message, completedAt: new Date().toISOString() });
    return next || task;
  } finally {
    activePolls.delete(id);
  }
}

export function publicUpscaleTask(task: UpscaleTask | null) {
  if (!task) return null;
  return {
    id: task.id,
    providerTaskId: task.providerTaskId,
    provider: task.provider,
    model: task.model,
    scale: task.scale,
    outputFormat: task.outputFormat,
    outputQuality: task.outputQuality,
    sourceImageId: task.sourceImageId,
    status: task.status,
    localImageUrl: task.localImageUrl,
    errorCode: task.errorCode,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    pollCount: task.pollCount,
  };
}

import { finishGenerationLog, startGenerationLog } from './generation-log';
import { getPublicState, getProviderWithKey, getRuntimeVideoModel } from './store';
import { persistGeneratedVideos } from './video-storage';
import { createVideoTask, findVideoTask, updateVideoTask, type VideoTask } from './video-task-store';
import { idempotencyKey, pollJimengVideo, pollRemoteVideo, runJimengVideo, submitRemoteVideo, VideoProviderError, type VideoProviderTask } from './video-providers';
import type { GeneratedVideo, VideoGenerationInput } from './types';
import { getVideoModelLimits, VIDEO_INPUT_SAFETY_LIMITS } from './video-model-limits';
import { is65535Provider, isJimengProvider } from './video-platform';
import { prepareVideoInputMedia } from './video-input-media';

function cleanInput(input: VideoGenerationInput, defaultSeconds = 5): VideoGenerationInput {
  const prompt = String(input.prompt || '').trim();
  const operation = input.operation === 'edit' || input.operation === 'extend' ? input.operation : 'generate';
  const requestedSeconds = Number(input.seconds);
  const fallbackSeconds = Number.isFinite(defaultSeconds) ? Math.max(1, Math.min(60, defaultSeconds)) : 5;
  const seconds = Number.isFinite(requestedSeconds) ? Math.max(1, Math.min(60, requestedSeconds)) : fallbackSeconds;
  const referenceVideos = Array.isArray(input.referenceVideos)
    ? input.referenceVideos.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 10)
    : input.referenceVideo ? [String(input.referenceVideo)] : [];
  const audios = Array.isArray(input.audios)
    ? input.audios.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 10)
    : input.audio ? [String(input.audio)] : [];
  return {
    prompt,
    operation,
    seconds,
    ...(input.aspectRatio ? { aspectRatio: String(input.aspectRatio) } : {}),
    ...(input.resolution ? { resolution: String(input.resolution) } : {}),
    ...(input.firstFrame ? { firstFrame: String(input.firstFrame) } : {}),
    ...(input.lastFrame ? { lastFrame: String(input.lastFrame) } : {}),
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 16) : [],
    ...(referenceVideos.length ? { referenceVideos, referenceVideo: referenceVideos[0] } : {}),
    ...(audios.length ? { audios, audio: audios[0] } : {}),
  };
}

function validItemCount(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0).length : 0;
}

function effectiveMediaCount(values: unknown, single: unknown) {
  const arrayCount = validItemCount(values);
  return arrayCount > 0 ? arrayCount : (typeof single === 'string' && single.length > 0 ? 1 : 0);
}

function assertGenericInputLimits(input: VideoGenerationInput) {
  const referenceImages = validItemCount(input.referenceImages);
  const referenceVideos = effectiveMediaCount(input.referenceVideos, input.referenceVideo);
  const audios = effectiveMediaCount(input.audios, input.audio);
  if (referenceImages > VIDEO_INPUT_SAFETY_LIMITS.maxReferenceImages) throw new Error(`参考图最多支持 ${VIDEO_INPUT_SAFETY_LIMITS.maxReferenceImages} 张，请减少后再提交。`);
  if (referenceVideos > VIDEO_INPUT_SAFETY_LIMITS.maxReferenceVideos) throw new Error(`参考视频最多支持 ${VIDEO_INPUT_SAFETY_LIMITS.maxReferenceVideos} 个，请减少后再提交。`);
  if (audios > VIDEO_INPUT_SAFETY_LIMITS.maxAudios) throw new Error(`音频最多支持 ${VIDEO_INPUT_SAFETY_LIMITS.maxAudios} 段，请减少后再提交。`);
}

function validateModelInput(input: VideoGenerationInput, rawInput: VideoGenerationInput, limits: ReturnType<typeof getVideoModelLimits>, providerLabel: '65535' | '即梦') {
  if (input.referenceImages && input.referenceImages.length > limits.maxReferenceImages) throw new Error(`当前${providerLabel}模型最多接收 ${limits.maxReferenceImages} 张参考图，请减少后再提交。`);
  const referenceVideos = input.referenceVideos || (input.referenceVideo ? [input.referenceVideo] : []);
  if (referenceVideos.length > limits.maxReferenceVideos) throw new Error(`当前${providerLabel}模型最多接收 ${limits.maxReferenceVideos} 个参考视频，请减少后再提交。`);
  const audios = input.audios || (input.audio ? [input.audio] : []);
  if (audios.length > limits.maxAudios) throw new Error(`当前${providerLabel}模型最多接收 ${limits.maxAudios} 段音频，请减少后再提交。`);

  const operation = input.operation || 'generate';
  const inheritsVideoSettings = operation !== 'generate' && Boolean(limits.inheritVideoSettingsFor?.includes(operation));
  const omitsAspectRatioResolution = inheritsVideoSettings || (operation !== 'generate' && Boolean(limits.omitAspectRatioResolutionFor?.includes(operation)));
  const seconds = Number(input.seconds);
  if (rawInput.seconds !== undefined && !inheritsVideoSettings) {
    if (limits.fixedSeconds && seconds !== limits.fixedSeconds) throw new Error(`当前${providerLabel}模型只支持 ${limits.fixedSeconds} 秒视频。`);
    if (limits.allowedSeconds && !limits.allowedSeconds.includes(seconds)) throw new Error(`当前${providerLabel}模型仅支持 ${limits.minSeconds}–${limits.maxSeconds} 秒视频。`);
    if (!limits.fixedSeconds && !limits.allowedSeconds && (seconds < limits.minSeconds || seconds > limits.maxSeconds)) throw new Error(`当前${providerLabel}模型仅支持 ${limits.minSeconds}–${limits.maxSeconds} 秒视频。`);
  }
  if (rawInput.resolution !== undefined && !omitsAspectRatioResolution && !limits.resolutions.includes(String(input.resolution))) {
    throw new Error(`当前${providerLabel}模型仅支持 ${limits.resolutions.join('、')}。`);
  }
}

function effectiveJimengLimits(input: VideoGenerationInput, limits: ReturnType<typeof getVideoModelLimits>) {
  const hasReferenceVideo = effectiveMediaCount(input.referenceVideos, input.referenceVideo) > 0;
  const hasAudio = effectiveMediaCount(input.audios, input.audio) > 0;
  const isMultiframe = !input.firstFrame && !input.lastFrame && !hasReferenceVideo && !hasAudio && (input.referenceImages?.length || 0) > 1;
  if (!isMultiframe) return limits;
  return {
    ...limits,
    minSeconds: 1,
    maxSeconds: 8,
    allowedSeconds: Array.from({ length: 8 }, (_, index) => index + 1),
    resolutions: ['720p', '1080p'],
  };
}

function isNativeTaskProvider(provider: { videoTransport?: string; platform?: string }) {
  return provider.videoTransport === 'native-task' || provider.platform === '65535';
}

function dataUriBytes(value: string) {
  if (!value.startsWith('data:')) return 0;
  const comma = value.indexOf(',');
  if (comma < 0) return 0;
  const payload = value.slice(comma + 1);
  return /;base64/i.test(value.slice(0, comma)) ? Math.floor(payload.replace(/\s/g, '').length * 3 / 4) : Buffer.byteLength(decodeURIComponent(payload), 'utf8');
}

function inlineMediaBytes(input: VideoGenerationInput) {
  return [input.firstFrame, input.lastFrame, ...(input.referenceImages || []), ...(input.referenceVideos || []), input.referenceVideo, ...(input.audios || []), input.audio]
    .filter((value): value is string => Boolean(value))
    .reduce((total, value) => total + dataUriBytes(value), 0);
}

async function callSubmit(runtime: NonNullable<Awaited<ReturnType<typeof getRuntimeVideoModel>>>, input: VideoGenerationInput, key: string) {
  return isJimengProvider(runtime.provider)
    ? runJimengVideo(runtime.provider, runtime.model.rawId, input)
    : submitRemoteVideo(runtime.provider, runtime.model.rawId, input, key);
}

async function callPoll(provider: Awaited<ReturnType<typeof getProviderWithKey>>, taskId: string) {
  if (!provider) throw new VideoProviderError('视频服务商不存在');
  return isJimengProvider(provider) ? pollJimengVideo(provider, taskId) : pollRemoteVideo(provider, taskId);
}

async function persistResult(task: VideoTask, result: VideoProviderTask) {
  const state = await getPublicState();
  const stored = await persistGeneratedVideos(result.videos, state.settings.videoStoragePath);
  const remoteVideoUrls = result.videos.map((video) => video.url);
  const videoUrls = stored.videos.map((video) => video.url);
  const completedAt = new Date().toISOString();
  const updated = await updateVideoTask(task.id, {
    status: 'done',
    videoUrls,
    remoteVideoUrls,
    localVideoPaths: stored.videos.map((video) => video.localPath).filter((item): item is string => Boolean(item)),
    // A provider can finish successfully even when the local download fails.
    // Keep the task usable with its remote URL and expose the recoverable
    // storage error so the UI can offer "再次保存".
    error: stored.storageError || '',
    costUsd: result.costUsd,
    completedAt,
    nextPollAt: undefined,
  });
  await finishGenerationLog(task.id, {
    status: 'success',
    durationMs: Date.now() - new Date(task.createdAt).getTime(),
    providerDurationMs: Date.now() - new Date(task.startedAt || task.createdAt).getTime(),
    videoUrls: remoteVideoUrls,
    videoPath: stored.videos.find((video) => video.localPath)?.localPath,
    storageError: stored.storageError,
    providerTaskId: task.providerTaskId,
    costUsd: result.costUsd,
  }).catch(() => undefined);
  return updated;
}

export async function saveVideoTaskLocally(id: string) {
  const task = await findVideoTask(id);
  if (!task) return null;
  if (!task.remoteVideoUrls.length) throw new Error('该任务没有可保存的远程视频地址');
  const stored = await persistGeneratedVideos(task.remoteVideoUrls.map((url) => ({ url })), (await getPublicState()).settings.videoStoragePath);
  return updateVideoTask(id, {
    videoUrls: stored.videos.map((video) => video.url),
    localVideoPaths: stored.videos.map((video) => video.localPath).filter((item): item is string => Boolean(item)),
    error: stored.storageError || '',
  });
}

async function failTask(task: VideoTask, error: unknown, code?: string) {
  const message = error instanceof Error ? error.message : String(error || '视频任务失败');
  const updated = await updateVideoTask(task.id, { status: 'failed', error: message, errorCode: code, completedAt: new Date().toISOString(), nextPollAt: undefined });
  await finishGenerationLog(task.id, { status: 'error', durationMs: Date.now() - new Date(task.createdAt).getTime(), error: message, errorCode: code }).catch(() => undefined);
  return updated;
}

export async function createVideoGeneration(options: { modelId?: string; input: VideoGenerationInput; idempotencyKey?: string }) {
  const runtime = await getRuntimeVideoModel(options.modelId || 'auto');
  if (!runtime) throw new Error('没有可用的视频模型。请先在模型库启用并发布视频模型。');
  assertGenericInputLimits(options.input);
  const baseModelLimits = getVideoModelLimits(runtime.model, runtime.provider);
  const input = await prepareVideoInputMedia(cleanInput(options.input, baseModelLimits.fixedSeconds || 5));
  const modelLimits = isJimengProvider(runtime.provider) ? effectiveJimengLimits(input, baseModelLimits) : baseModelLimits;
  if (!input.prompt) throw new Error('请输入视频提示词');
  if (is65535Provider(runtime.provider) || isJimengProvider(runtime.provider)) validateModelInput(input, options.input, modelLimits, isJimengProvider(runtime.provider) ? '即梦' : '65535');
  if (isNativeTaskProvider(runtime.provider)) {
    if (is65535Provider(runtime.provider) && input.audios?.length && !runtime.model.capabilities.includes('video-audio')) throw new Error('当前 65535 视频模型未声明音频输入，请移除音频后再提交。');
    const inlineBytes = inlineMediaBytes(input);
    if (inlineBytes > 64 * 1024 * 1024) throw new Error(`65535 原生接口的本地素材请求不能超过 64 MiB（当前约 ${(inlineBytes / (1024 * 1024)).toFixed(1)} MiB）。请换用更小的素材；任务尚未提交，不会扣费。`);
  }
  const key = options.idempotencyKey?.trim() || idempotencyKey();
  const existing = await (await import('./video-task-store')).findVideoTaskByIdempotencyKey(key);
  if (existing) return existing;
  const created = await createVideoTask({
    providerId: runtime.provider.id,
    modelId: runtime.model.id,
    modelName: runtime.model.displayName,
    operation: input.operation || 'generate',
    status: 'pending',
    idempotencyKey: key,
    input,
  });
  if (!created.created) return created.task;
  const task = created.task;
  await startGenerationLog({ mode: 'video', mediaKind: 'video', source: 'workspace', prompt: input.prompt, modelId: runtime.model.id, modelName: runtime.model.displayName, providerName: runtime.provider.name, operation: input.operation || 'generate', idempotencyKey: key }, task.id);
  try {
    const result = await callSubmit(runtime, input, key);
    if (result.status === 'done' && result.videos.length) return persistResult({ ...task, providerTaskId: result.providerTaskId }, result);
    if (result.status === 'failed') return failTask(task, result.error || '视频任务失败', result.errorCode);
    if (result.status === 'done') return failTask(task, '服务商已完成任务，但没有返回可下载的视频地址', 'VIDEO_RESULT_MISSING');
    const updated = await updateVideoTask(task.id, { status: result.status === 'running' ? 'running' : 'pending', providerTaskId: result.providerTaskId, startedAt: new Date().toISOString(), nextPollAt: Date.now() + 2000, costUsd: result.costUsd });
    return updated;
  } catch (error) {
    return failTask(task, error, error instanceof VideoProviderError ? error.code : undefined);
  }
}

export async function refreshVideoTask(id: string) {
  const task = await findVideoTask(id);
  if (!task) return null;
  if (task.status === 'done' || task.status === 'failed') return task;
  if (!task.providerTaskId) return task;
  if (task.nextPollAt && task.nextPollAt > Date.now()) return task;
  const provider = await getProviderWithKey(task.providerId);
  if (!provider) return failTask(task, '视频服务商配置已删除', 'PROVIDER_NOT_FOUND');
  try {
    const result = await callPoll(provider, task.providerTaskId);
    if (result.status === 'done' && result.videos.length) return persistResult(task, result);
    if (result.status === 'failed') return failTask(task, result.error || '视频任务失败', result.errorCode);
    const pollCount = task.pollCount + 1;
    const interval = Math.min(5000, 2000 + Math.max(0, pollCount - 2) * 500);
    return updateVideoTask(id, { status: result.status, pollCount, nextPollAt: Date.now() + interval });
  } catch (error) {
    if (error instanceof VideoProviderError && error.status === 429) {
      const pollCount = task.pollCount + 1;
      const backoff = error.retryAfterMs || Math.min(30_000, 2000 * 2 ** Math.min(4, pollCount));
      return updateVideoTask(id, { pollCount, nextPollAt: Date.now() + backoff });
    }
    return failTask(task, error, error instanceof VideoProviderError ? error.code : undefined);
  }
}

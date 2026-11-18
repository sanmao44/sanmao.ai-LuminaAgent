import type { CangyuanMediaTask } from '../../packages/contracts/cangyuan-media';
import { getCangyuanMusicModelProfile, validateCangyuanMusicInput, type CangyuanMusicOptions } from '../../packages/contracts/cangyuan-media';
import type { AudioTranscriptionResult } from '../../packages/contracts/audio-transcription';
import type { CanvasAudioDraft, CanvasAudioGenerationMeta, CanvasAudioMusicDraft, CanvasAudioMusicTask, CanvasAudioTranscriptionDraft, CanvasAudioTranscriptionMeta, CanvasDocument, CanvasGenerationStatus } from './types';
import { filterModelsByActiveProviders } from '../provider-availability';
import type { ProviderConnection, RegistryModel } from '../types';

export function canvasAudioSpeechModels(models: RegistryModel[], providers: ProviderConnection[]) {
  const compatibleProviders = providers.filter((provider) => provider.type === 'openai-compatible');
  return filterModelsByActiveProviders(models, compatibleProviders, { capability: 'speech' });
}

export function canvasAudioSpeechHistory(
  previousGeneration: CanvasAudioGenerationMeta | undefined,
  previousGenerations: CanvasAudioGenerationMeta[] | undefined,
  nextGeneration?: CanvasAudioGenerationMeta,
) {
  const history = previousGenerations?.length
    ? previousGenerations
    : previousGeneration
      ? [previousGeneration]
      : [];
  return nextGeneration
    ? [nextGeneration, ...history].slice(0, 20)
    : history.length ? history : undefined;
}

export function canvasAudioMusicModels(models: RegistryModel[], providers: ProviderConnection[]) {
  const taskProviders = providers.filter((provider) => provider.type === 'openai-compatible' && provider.creativeTaskProtocol === 'cangyuan-creative-v1');
  return filterModelsByActiveProviders(models, taskProviders, { capability: 'music-generate' })
    .filter((model) => {
      const profile = getCangyuanMusicModelProfile(model.rawId);
      return profile !== null && profile.family !== 'suno-sfx' && profile.family !== 'elevenlabs-sfx';
    });
}

export function canvasAudioSoundEffectModels(models: RegistryModel[], providers: ProviderConnection[]) {
  const taskProviders = providers.filter((provider) => provider.type === 'openai-compatible' && provider.creativeTaskProtocol === 'cangyuan-creative-v1');
  return filterModelsByActiveProviders(models, taskProviders, { capability: 'sound-effect' })
    .filter((model) => {
      const profile = getCangyuanMusicModelProfile(model.rawId);
      return profile?.family === 'suno-sfx' || profile?.family === 'elevenlabs-sfx';
    });
}

export function canvasAudioTranscriptionModels(models: RegistryModel[], providers: ProviderConnection[]) {
  const compatibleProviders = providers.filter((provider) => provider.type === 'openai-compatible');
  return filterModelsByActiveProviders(models, compatibleProviders, { capability: 'transcription' });
}

export function buildCanvasMusicRequest(modelId: string, rawModelId: string, prompt: string, options: CangyuanMusicOptions) {
  const profile = getCangyuanMusicModelProfile(rawModelId);
  if (!profile) throw new Error('所选模型暂不支持音乐任务。');
  const supportedOptions = profile.allowedOptions.reduce<CangyuanMusicOptions>((result, key) => {
    const value = options[key];
    if (value !== undefined) Object.assign(result, { [key]: value });
    return result;
  }, {});
  const validated = validateCangyuanMusicInput(rawModelId, { prompt, ...supportedOptions });
  return { kind: 'music' as const, modelId, prompt: validated.prompt || '', options: supportedOptions };
}

export function canvasMusicTaskSnapshot(task: CangyuanMediaTask): CanvasAudioMusicTask {
  if (task.kind !== 'music') throw new Error('返回任务类型与音乐节点不匹配。');
  return {
    id: task.id,
    modelId: task.modelId,
    providerModel: task.providerModel,
    modelName: task.modelName,
    ...(task.input.prompt ? { prompt: task.input.prompt } : {}),
    status: task.status,
    outputs: task.outputs,
    ...(task.error ? { error: task.error } : {}),
    ...(task.providerStatus ? { providerStatus: task.providerStatus } : {}),
    createdAt: task.createdAt,
  };
}

function sameDraft(left: CanvasAudioDraft | undefined, right: CanvasAudioDraft) {
  return left?.text === right.text
    && left?.voice === right.voice
    && left?.modelId === right.modelId
    && left?.format === right.format
    && left?.speed === right.speed;
}

export function updateCanvasAudioDraftDocument(document: CanvasDocument, nodeId: string, draft: CanvasAudioDraft) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio' || sameDraft(node.data.speechDraft, draft)) return node;
    changed = true;
    return { ...node, data: { ...node.data, speechDraft: draft } };
  });
  return changed ? { ...document, nodes } : document;
}

export function updateCanvasAudioTranscriptionDraftDocument(document: CanvasDocument, nodeId: string, draft: CanvasAudioTranscriptionDraft) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    if (JSON.stringify(node.data.transcriptionDraft) === JSON.stringify(draft)) return node;
    changed = true;
    return { ...node, data: { ...node.data, transcriptionDraft: draft } };
  });
  return changed ? { ...document, nodes } : document;
}

export function updateCanvasAudioMusicDraftDocument(document: CanvasDocument, nodeId: string, draft: CanvasAudioMusicDraft) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    if (JSON.stringify(node.data.musicDraft) === JSON.stringify(draft)) return node;
    changed = true;
    return { ...node, data: { ...node.data, musicDraft: draft } };
  });
  return changed ? { ...document, nodes } : document;
}

export function updateCanvasAudioSoundEffectDraftDocument(document: CanvasDocument, nodeId: string, draft: CanvasAudioMusicDraft) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    if (JSON.stringify(node.data.soundEffectDraft) === JSON.stringify(draft)) return node;
    changed = true;
    return { ...node, data: { ...node.data, soundEffectDraft: draft } };
  });
  return changed ? { ...document, nodes } : document;
}

export function updateCanvasAudioMusicTaskDocument(document: CanvasDocument, nodeId: string, task: CanvasAudioMusicTask) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    const previousTasks = node.data.musicTasks?.length
      ? node.data.musicTasks
      : node.data.musicTask
        ? [node.data.musicTask]
        : [];
    const previous = previousTasks.find((item) => item.id === task.id);
    if (JSON.stringify(previous) === JSON.stringify(task)) return node;
    changed = true;
    const musicTasks = [task, ...previousTasks.filter((item) => item.id !== task.id)].slice(0, 20);
    const latest = musicTasks[0];
    const status: CanvasGenerationStatus = latest.status === 'succeeded' ? 'completed'
      : latest.status === 'failed' || latest.status === 'cancelled' ? 'failed'
        : latest.status === 'queued' ? 'queued' : 'running';
    const statusLabel = status === 'completed' ? '音乐已完成' : status === 'failed' ? '音乐生成失败' : '音乐生成中';
    return { ...node, data: { ...node.data, musicTasks, status, statusLabel } };
  });
  return changed ? { ...document, nodes } : document;
}

export function appendCanvasAudioTranscriptionDocument(document: CanvasDocument, nodeId: string, result: CanvasAudioTranscriptionMeta) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    changed = true;
    const previousResults = node.data.transcriptions?.length
      ? node.data.transcriptions
      : node.data.transcription
        ? [node.data.transcription]
        : [];
    return { ...node, data: { ...node.data, transcriptions: [result, ...previousResults].slice(0, 20) } };
  });
  return changed ? { ...document, nodes } : document;
}

export function canvasTranscriptionResult(value: unknown, sourceAudioName: string) {
  if (!value || typeof value !== 'object') throw new Error('转写服务返回了无效结果。');
  const result = value as Partial<Omit<AudioTranscriptionResult, 'historyError'>>;
  if (typeof result.text !== 'string' || typeof result.modelId !== 'string' || typeof result.modelName !== 'string') {
    throw new Error('转写服务返回了不完整结果。');
  }
  return {
    text: result.text,
    modelId: result.modelId,
    modelName: result.modelName,
    ...(typeof result.language === 'string' ? { language: result.language } : {}),
    ...(Array.isArray(result.segments) ? { segments: result.segments.filter((segment): segment is { start: number; end: number; text: string } => Boolean(segment)
      && Number.isFinite(segment.start) && Number.isFinite(segment.end) && typeof segment.text === 'string') } : {}),
    responseFormat: typeof result.responseFormat === 'string' ? result.responseFormat : 'verbose_json',
    temperature: Number.isFinite(result.temperature) ? result.temperature : 0,
    sourceAudioName,
    createdAt: Date.now(),
  };
}

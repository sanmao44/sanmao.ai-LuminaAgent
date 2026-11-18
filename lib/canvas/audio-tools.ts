import type { CangyuanMediaTask } from '../../packages/contracts/cangyuan-media';
import { getCangyuanMusicModelProfile, validateCangyuanMusicInput, type CangyuanMusicOptions } from '../../packages/contracts/cangyuan-media';
import type { CanvasAudioDraft, CanvasAudioMusicDraft, CanvasAudioMusicTask, CanvasAudioTranscriptionDraft, CanvasDocument, CanvasGenerationStatus } from './types';
import { filterModelsByActiveProviders } from '../provider-availability';
import type { ProviderConnection, RegistryModel } from '../types';

export function canvasAudioMusicModels(models: RegistryModel[], providers: ProviderConnection[]) {
  const taskProviders = providers.filter((provider) => provider.creativeTaskProtocol === 'cangyuan-creative-v1');
  return filterModelsByActiveProviders(models, taskProviders, { capability: 'music-generate' })
    .filter((model) => getCangyuanMusicModelProfile(model.rawId) !== null);
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

export function updateCanvasAudioMusicTaskDocument(document: CanvasDocument, nodeId: string, task: CanvasAudioMusicTask) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== 'media' || node.data.kind !== 'audio') return node;
    if (JSON.stringify(node.data.musicTask) === JSON.stringify(task)) return node;
    changed = true;
    const status: CanvasGenerationStatus = task.status === 'succeeded' ? 'completed'
      : task.status === 'failed' || task.status === 'cancelled' ? 'failed'
        : task.status === 'queued' ? 'queued' : 'running';
    const statusLabel = status === 'completed' ? '音乐已完成' : status === 'failed' ? '音乐生成失败' : '音乐生成中';
    return { ...node, data: { ...node.data, musicTask: task, status, statusLabel } };
  });
  return changed ? { ...document, nodes } : document;
}

export function canvasTranscriptionResult(value: unknown, sourceAudioName: string) {
  const result = value as Omit<import('../../packages/contracts/audio-transcription').AudioTranscriptionResult, 'historyError'>;
  return {
    ...result,
    sourceAudioName,
    createdAt: Date.now(),
  };
}

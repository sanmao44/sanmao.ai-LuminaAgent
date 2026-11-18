import type { ModelCapability, ModelKind, RegistryModel } from './types';

export type ModelLibraryCategory = 'all' | 'chat' | 'image' | 'video' | 'speech' | 'music' | 'transcription' | '3d' | 'unknown';

const audioTaskCapabilities = ['speech', 'music-generate', 'transcription'] as const satisfies readonly ModelCapability[];

const categoryCapabilities: Partial<Record<ModelLibraryCategory, ModelCapability>> = {
  speech: 'speech',
  music: 'music-generate',
  transcription: 'transcription',
};

const audioTaskLabels: Record<(typeof audioTaskCapabilities)[number], string> = {
  speech: '配音模型',
  'music-generate': '音乐生成模型',
  transcription: '语音转写模型',
};

export function modelMatchesLibraryCategory(model: Pick<RegistryModel, 'kind' | 'capabilities' | 'source'>, category: ModelLibraryCategory) {
  if (category === 'all') return true;
  const capability = categoryCapabilities[category];
  if (capability) {
    if (model.kind === 'audio' && model.capabilities.includes(capability)) return true;
    // Older audio records may not have a specific task capability. Preserve
    // their historic speech behavior without absorbing known music or ASR.
    return category === 'speech'
      && model.kind === 'audio'
      && model.source !== 'discovered'
      && !audioTaskCapabilities.some((item) => model.capabilities.includes(item));
  }
  return model.kind === category;
}

export function modelLibraryCategoryLabel(model: Pick<RegistryModel, 'kind' | 'capabilities' | 'source'>) {
  if (model.kind !== 'audio') return model.kind === 'unknown' ? '待分类' : `${modelKindLabel(model.kind)}模型`;
  const taskLabels = audioTaskCapabilities
    .filter((capability) => model.capabilities.includes(capability))
    .map((capability) => audioTaskLabels[capability].replace('模型', ''));
  if (!taskLabels.length) return model.source === 'discovered' ? '音频用途待确认' : audioTaskLabels.speech;
  if (taskLabels.length > 1) return `多用途音频 · ${taskLabels.join(' / ')}`;
  return audioTaskLabels[audioTaskCapabilities.find((capability) => model.capabilities.includes(capability))!];
}

function modelKindLabel(kind: ModelKind) {
  if (kind === 'chat') return '对话';
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  if (kind === '3d') return '三维';
  return '音频';
}

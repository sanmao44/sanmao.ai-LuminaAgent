import type { ModelCapability, ModelKind, RegistryModel } from './types';
import type { ModelClassificationSource } from '@/packages/contracts/model-classification';

export type ModelLibraryCategory = 'all' | 'chat' | 'image' | 'video' | 'speech' | 'music' | 'sound-effect' | 'transcription' | 'conversation' | '3d' | 'unknown';

const audioTaskCapabilities = ['speech', 'music-generate', 'sound-effect', 'transcription', 'audio-conversation'] as const satisfies readonly ModelCapability[];

const categoryCapabilities: Partial<Record<ModelLibraryCategory, ModelCapability>> = {
  speech: 'speech',
  music: 'music-generate',
  'sound-effect': 'sound-effect',
  transcription: 'transcription',
  conversation: 'audio-conversation',
};

const audioTaskLabels: Record<(typeof audioTaskCapabilities)[number], string> = {
  speech: '配音模型',
  'music-generate': '音乐生成模型',
  'sound-effect': '音效模型',
  transcription: '语音转写模型',
  'audio-conversation': '音频对话模型',
};

export function modelMatchesLibraryCategory(model: Pick<RegistryModel, 'kind' | 'capabilities' | 'source'>, category: ModelLibraryCategory) {
  if (category === 'all') return true;
  const capability = categoryCapabilities[category];
  if (capability) {
    if (category === 'music' && model.kind === 'audio' && model.capabilities.includes('sound-effect')) return false;
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

export function modelLibraryCategoryLabel(model: Pick<RegistryModel, 'kind' | 'capabilities' | 'source' | 'classification'>) {
  if (model.kind !== 'audio') {
    if (model.kind === 'unknown' && model.classification?.requiresReview && model.classification.evidence.some((item) => /audio|speech|voice|music|sound|asr|tts|transcri/i.test(item.value))) return '音频用途待确认';
    return model.kind === 'unknown' ? '待分类' : `${modelKindLabel(model.kind)}模型`;
  }
  const classification = model.classification;
  const classifiedPurposes = classification?.purposes || [];
  if (classifiedPurposes.length) {
    const labels = classifiedPurposes.map((purpose) => purpose === 'speech' ? '配音' : purpose === 'transcription' ? '语音转写' : purpose === 'music' ? '音乐' : purpose === 'sound-effect' ? '音效' : purpose === 'conversation' ? '音频对话' : '').filter(Boolean);
    if (labels.length) return labels.length > 1 ? `多用途音频 · ${labels.join(' / ')}` : `${labels[0]}模型`;
  }
  const taskLabels = audioTaskCapabilities
    .filter((capability) => model.capabilities.includes(capability) && !(capability === 'music-generate' && model.capabilities.includes('sound-effect')))
    .map((capability) => audioTaskLabels[capability].replace('模型', ''));
  if (!taskLabels.length) return model.source === 'discovered' ? '音频用途待确认' : audioTaskLabels.speech;
  if (taskLabels.length > 1) return `多用途音频 · ${taskLabels.join(' / ')}`;
  return audioTaskLabels[audioTaskCapabilities.find((capability) => model.capabilities.includes(capability))!];
}

const classificationSourceLabels: Record<ModelClassificationSource, string> = {
  official: '官方标注',
  'provider-metadata': '接口标注',
  adapter: '适配器标注',
  heuristic: '名称推断',
  'local-ai-suggested': 'AI 建议',
  manual: '人工标注',
};

export function modelClassificationLabel(model: Pick<RegistryModel, 'classification'>) {
  const classification = model.classification;
  if (!classification) return '';
  if (classification.requiresReview) return `${classificationSourceLabels[classification.source]} · 待复核`;
  return classificationSourceLabels[classification.source];
}

export function modelClassificationHint(model: Pick<RegistryModel, 'classification'>) {
  const classification = model.classification;
  if (!classification) return '';
  const evidence = classification.evidence.map((item) => item.value).filter(Boolean).join('、');
  const confidence = classification.confidence === 'high' ? '高可信' : classification.confidence === 'medium' ? '中可信' : '低可信';
  return `${modelClassificationLabel(model)}，${confidence}${evidence ? `；依据：${evidence}` : ''}`;
}

function modelKindLabel(kind: ModelKind) {
  if (kind === 'chat') return '对话';
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  if (kind === '3d') return '三维';
  return '音频';
}

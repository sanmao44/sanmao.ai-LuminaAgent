import { getProviderPreset } from '@/lib/provider-presets';
import type { ModelKind, ProviderPlatform, ProviderType } from '@/lib/types';

export function modelKindLabel(kind: ModelKind | string | null | undefined) {
  if (kind === 'chat') return '对话模型';
  if (kind === 'image') return '图片模型';
  if (kind === 'video') return '视频模型';
  if (kind === 'audio') return '配音模型';
  return '未分类';
}

export function providerTypeLabel(type: ProviderType | string | null | undefined) {
  return type === 'google-gemini' ? '谷歌 Gemini' : '通用兼容接口';
}

export function isManualModelProvider(provider: { type?: ProviderType | string } | null | undefined) {
  return provider?.type === 'openai-compatible' || provider?.type === 'google-gemini';
}

export function providerPlatformLabel(platform: ProviderPlatform | string | null | undefined) {
  return getProviderPreset(platform ?? undefined).short || '自定义';
}

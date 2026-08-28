import type { DiscoveredModel } from './providers';
import type { ModelBilling, ModelCapability, ModelKind } from './types';

export const AGNES_API_BASE_URL = 'https://apihub.agnes-ai.com/v1';
export const AGNES_VIDEO_BASE_URL = 'https://apihub.agnes-ai.com';
export const AGNES_API_KEY_URL = 'https://platform.agnes-ai.cn/settings/apiKeys';

export type AgnesModelDefinition = {
  id: string;
  name: string;
  kind: ModelKind;
  billing: ModelBilling;
  enabledByDefault: boolean;
  capabilities: ModelCapability[];
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

const textModels: AgnesModelDefinition[] = [
  { id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash', kind: 'chat', billing: 'free', enabledByDefault: true, capabilities: ['chat', 'vision'], contextWindow: 512_000, maxOutputTokens: 65_536 },
  { id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash', kind: 'chat', billing: 'free', enabledByDefault: true, capabilities: ['chat', 'vision'], contextWindow: 512_000, maxOutputTokens: 65_536 },
  { id: 'agnes-2.5-pro-alpha', name: 'Agnes 2.5 Pro Alpha', kind: 'chat', billing: 'paid', enabledByDefault: false, capabilities: ['chat', 'vision'], contextWindow: 1_000_000, maxOutputTokens: 65_536 },
  { id: 'agnes-2.5-pro-beta', name: 'Agnes 2.5 Pro Beta', kind: 'chat', billing: 'paid', enabledByDefault: false, capabilities: ['chat', 'vision'], contextWindow: 1_000_000, maxOutputTokens: 65_536 },
  { id: 'agnes-2.5-pro', name: 'Agnes 2.5 Pro', kind: 'chat', billing: 'paid', enabledByDefault: false, capabilities: ['chat', 'vision'], contextWindow: 1_000_000, maxOutputTokens: 65_536 },
];

const imageModels: AgnesModelDefinition[] = [
  { id: 'agnes-image-2.0-flash', name: 'Agnes Image 2.0 Flash', kind: 'image', billing: 'free', enabledByDefault: true, capabilities: ['generate', 'edit', 'reference'], maxOutputTokens: 1 },
  { id: 'agnes-image-2.1-flash', name: 'Agnes Image 2.1 Flash', kind: 'image', billing: 'free', enabledByDefault: true, capabilities: ['generate', 'edit', 'reference'], maxOutputTokens: 1 },
];

const videoModels: AgnesModelDefinition[] = [
  { id: 'agnes-video-v2.0', name: 'Agnes Video V2.0', kind: 'video', billing: 'free', enabledByDefault: true, capabilities: ['video-generate', 'video-first-frame', 'video-reference'] },
  { id: 'agnes-video-2.5', name: 'Agnes Video 2.5', kind: 'video', billing: 'paid', enabledByDefault: false, capabilities: ['video-generate', 'video-first-frame', 'video-reference', 'video-audio'] },
  { id: 'agnes-video-2.5-flash', name: 'Agnes Video 2.5 Flash', kind: 'video', billing: 'temporary-free', enabledByDefault: true, capabilities: ['video-generate', 'video-first-frame', 'video-reference', 'video-audio'] },
];

export const agnesModelDefinitions = [...textModels, ...imageModels, ...videoModels];

export const agnesModelCatalog: DiscoveredModel[] = agnesModelDefinitions.map((model) => ({
  id: model.id,
  name: model.name,
  capabilities: model.capabilities,
  billing: model.billing,
  enabledByDefault: model.enabledByDefault,
  contextWindow: model.contextWindow,
  maxInputTokens: model.maxInputTokens,
  maxOutputTokens: model.maxOutputTokens,
}));

export function isAgnesModel(rawId?: string) {
  return /^agnes-/i.test(String(rawId || '').trim());
}

export function agnesModelDefinition(rawId?: string) {
  const id = String(rawId || '').trim();
  return agnesModelDefinitions.find((model) => model.id === id) || null;
}

export function agnesBillingLabel(billing?: ModelBilling) {
  return billing === 'paid' ? '付费' : billing === 'temporary-free' ? '限时免费' : billing === 'free' ? '当前免费' : '';
}

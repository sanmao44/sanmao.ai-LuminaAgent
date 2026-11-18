/** Values accepted by model-specific video controls. Media references stay in dedicated fields. */
export type VideoModelParameterValue = string | number | boolean | string[];
export type VideoModelParameterValues = Record<string, VideoModelParameterValue>;

export type CangyuanVideoParameterSpec = {
  name: string;
  description?: string;
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'array';
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  enum?: string[] | string;
  suggestions?: string[] | string;
  suggestedDefault?: string | number | boolean;
  role?: string;
};

export type CangyuanVideoModelSpec = {
  [key: string]: unknown;
  publicModel: string;
  /** Capability tags from the official catalog, e.g. video. */
  capabilityRefs?: string[];
  intro?: string | null;
  warnings?: string[];
  examples?: Array<{ title?: string; request?: Record<string, unknown>; response?: Record<string, unknown> }>;
  sections?: Array<{ title?: string; items?: string[]; variant?: string }>;
  params: CangyuanVideoParameterSpec[];
  endpoints?: Array<{ method?: string; path?: string; description?: string }>;
  source?: string;
  lastReviewed?: string;
};

export type CangyuanVideoModelCatalogEntry = {
  id: string;
  publicModel: string;
  title: string;
  summary: string;
  source: string;
  lastReviewed: string;
  status: 'current';
  spec: CangyuanVideoModelSpec;
};

const PARAMETER_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_PARAMETERS = 40;
const MAX_PARAMETER_STRING_LENGTH = 20_000;

export function parseVideoModelParameterValues(value: unknown): VideoModelParameterValues {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('视频模型高级设置格式无效。');
  const entries = Object.entries(value);
  if (entries.length > MAX_PARAMETERS) throw new Error(`视频模型高级设置最多支持 ${MAX_PARAMETERS} 项。`);
  const parsed: Array<[string, VideoModelParameterValue]> = [];
  for (const [key, item] of entries) {
    if (!PARAMETER_KEY.test(key) || key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('视频模型高级设置包含无效字段。');
    }
    if (typeof item === 'string') {
      if (item.length > MAX_PARAMETER_STRING_LENGTH) throw new Error(`视频模型高级设置 ${key} 的文本过长。`);
      parsed.push([key, item]);
    } else if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean') {
      parsed.push([key, item]);
    } else if (Array.isArray(item) && item.length <= 100 && item.every((entry) => typeof entry === 'string' && entry.length <= MAX_PARAMETER_STRING_LENGTH)) {
      parsed.push([key, item]);
    } else {
      throw new Error(`视频模型高级设置 ${key} 的值必须是文本、数字、开关或文本列表。`);
    }
  }
  return Object.fromEntries(parsed);
}

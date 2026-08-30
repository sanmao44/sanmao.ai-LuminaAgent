import type { UpscaleModel, UpscaleModelId, UpscaleProviderId } from './types';

export const UPSCALE_PROVIDER_NAMES: Record<UpscaleProviderId, string> = {
  'tencent-ci': '腾讯云数据万象',
  'aliyun-viapi': '阿里云视觉智能开放平台',
};

export const UPSCALE_PROVIDER_LINKS = {
  'tencent-ci': {
    keys: 'https://console.cloud.tencent.com/cam/capi',
    open: 'https://console.cloud.tencent.com/ci',
    docs: ['https://cloud.tencent.com/document/api/436/117793'],
    pricing: 'https://cloud.tencent.com/document/product/460/58117',
  },
  'aliyun-viapi': {
    keys: 'https://ram.console.aliyun.com/profile/access-keys',
    open: 'https://vision.aliyun.com/experience/detail?type=super-resolution',
    docs: [
      'https://help.aliyun.com/zh/viapi/developer-reference/api-px24vm',
      'https://help.aliyun.com/en/viapi/developer-reference/api-generated-image-super-score',
    ],
    pricing: 'https://www.aliyun.com/price/product#/viapi',
  },
} as const;

type CatalogEntry = Omit<UpscaleModel, 'providerId' | 'connected' | 'enabled' | 'published'>;

const entries: CatalogEntry[] = [
  {
    id: 'tencent-super-resolution',
    provider: 'tencent-ci',
    providerName: UPSCALE_PROVIDER_NAMES['tencent-ci'],
    displayName: '腾讯云 · 高清超分',
    rawId: 'AISuperResolution',
    description: '稳定、快速，尽量保持原图内容',
    detail: '偏忠实型增强，主要提升分辨率和清晰度，不强调重新生成内容。适合商品图、摄影图、设计图和普通生图。',
    recommendation: '商品图 / 普通照片 / 设计图 / 希望保持原图',
    scales: [1, 2, 4],
    kind: 'image',
    capabilities: ['edit', 'reference', 'upscale'],
    links: UPSCALE_PROVIDER_LINKS['tencent-ci'],
  },
  {
    id: 'aliyun-standard-super-resolution',
    provider: 'aliyun-viapi',
    providerName: UPSCALE_PROVIDER_NAMES['aliyun-viapi'],
    displayName: '阿里云 · 标准超分',
    rawId: 'MakeSuperResolutionImage',
    description: '清晰放大并降低噪点',
    detail: '重点提升清晰度、纹理和分辨率，同时尽量保持原图内容，适合照片、商品图和设计素材。',
    recommendation: '照片 / 商品 / 设计素材 / 去噪增强',
    scales: [1, 2, 3, 4],
    kind: 'image',
    capabilities: ['edit', 'reference', 'upscale'],
    links: UPSCALE_PROVIDER_LINKS['aliyun-viapi'],
  },
  {
    id: 'aliyun-generative-super-resolution',
    provider: 'aliyun-viapi',
    providerName: UPSCALE_PROVIDER_NAMES['aliyun-viapi'],
    displayName: '阿里云 · AI 生成式超分',
    rawId: 'GenerateSuperResolutionImage',
    description: 'AI 补充纹理和细节，效果更明显',
    detail: '生成式增强会重新补充头发、皮肤、材质和建筑等细节，视觉提升更明显，但可能产生原图中不存在的新细节。',
    recommendation: 'AI 生图 / 人像 / 摄影 / 低清图片',
    scales: [1, 2, 3, 4],
    generative: true,
    kind: 'image',
    capabilities: ['edit', 'reference', 'upscale'],
    links: UPSCALE_PROVIDER_LINKS['aliyun-viapi'],
  },
];

export const UPSCALE_CATALOG = entries;

export function isUpscaleModelId(value: unknown): value is UpscaleModelId {
  return entries.some((entry) => entry.id === value);
}

export function getUpscaleCatalogModel(id: string) {
  return entries.find((entry) => entry.id === id) || null;
}

export function buildPublicUpscaleModels(connectedProviders: Set<UpscaleProviderId>): UpscaleModel[] {
  return entries.map((entry) => ({
    ...entry,
    providerId: entry.provider,
    enabled: true,
    published: true,
    connected: connectedProviders.has(entry.provider),
  }));
}

export function preferredUpscaleModelId(connectedProviders: Set<UpscaleProviderId>, hasLegacyModel = false): string | null {
  if (connectedProviders.has('tencent-ci')) return 'tencent-super-resolution';
  if (connectedProviders.has('aliyun-viapi')) return 'aliyun-standard-super-resolution';
  return hasLegacyModel ? 'legacy' : null;
}

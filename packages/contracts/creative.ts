export type CreativeReference = {
  id: string;
  kind: 'image' | 'video' | 'text';
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  nodeId?: string;
  pending?: boolean;
  error?: string;
};

export type CreativeProjectBrief = {
  /** The user's project idea, reused as the starting point for creation. */
  intent?: string;
  style: string;
  audience: string;
  constraints: string;
  /** The intended project outcome. Omitted means the legacy automatic route. */
  deliverable?: CreativeProjectDeliverable;
};

export type CreativeProjectDeliverable = 'auto' | 'video' | 'image' | 'audio' | 'copy' | 'freeform';

export const CREATIVE_PROJECT_DELIVERABLE_OPTIONS: ReadonlyArray<{
  value: CreativeProjectDeliverable;
  label: string;
  description: string;
}> = [
  { value: 'auto', label: '自动判断', description: '沿用项目内容自动推荐下一步' },
  { value: 'video', label: '视频成片', description: '优先串联脚本、画面、配音和剪辑' },
  { value: 'image', label: '图像作品', description: '完成视觉素材后进入版本检查点' },
  { value: 'audio', label: '音频作品', description: '优先把脚本推进为配音或音频素材' },
  { value: 'copy', label: '文案交付', description: '专注脚本、文案和可复用内容' },
  { value: 'freeform', label: '自由创作', description: '保留辅助推荐，不强制固定媒介链路' },
];

export function normalizeCreativeProjectBrief(value: unknown): CreativeProjectBrief | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const intent = typeof source.intent === 'string' ? source.intent.trim() : '';
  const brief: CreativeProjectBrief = {
    style: typeof source.style === 'string' ? source.style.trim() : '',
    audience: typeof source.audience === 'string' ? source.audience.trim() : '',
    constraints: typeof source.constraints === 'string' ? source.constraints.trim() : '',
  };
  const deliverable = source.deliverable === 'video'
    || source.deliverable === 'image'
    || source.deliverable === 'audio'
    || source.deliverable === 'copy'
    || source.deliverable === 'freeform'
    || source.deliverable === 'auto'
    ? source.deliverable
    : undefined;
  if (deliverable) brief.deliverable = deliverable;
  if (intent) brief.intent = intent;
  return intent || brief.style || brief.audience || brief.constraints || (deliverable && deliverable !== 'auto') ? brief : null;
}

/**
 * Shared creative routing contract for the main Agent and Canvas Agent.
 * `lane` controls which tools may run; `operation` describes visual work.
 */
export type CreativeLane = 'prompt' | 'image' | 'chat' | 'clarify';
export type CreativeOperation = 'none' | 'generate' | 'edit' | 'reference-generate';
export type ImageRequestOperation = Extract<CreativeOperation, 'generate' | 'edit' | 'reference-generate'>;
export type ImageRequestMode = ImageRequestOperation | 'auto';
export type ImageIntentClassifierStatus = 'used' | 'fallback' | 'unavailable';
export type CanvasImageIntentPreviewRequest = {
  prompt: string;
  imageReferenceCount: number;
  hasMask: boolean;
};
export type CanvasImageIntentPreview = {
  operation: ImageRequestOperation;
  classifierStatus?: ImageIntentClassifierStatus;
  classifierModelId?: string;
  classifierMs?: number;
};
export const MAX_IMAGE_REFERENCES = 16;
export const MAX_CREATIVE_PROJECT_REFERENCE_ASSETS = 8;
export type CreativeExecution = 'none' | 'preview' | 'run';

export type CreativeRoute = {
  lane: CreativeLane;
  operation: CreativeOperation;
  execution: CreativeExecution;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  requiresReference: boolean;
};

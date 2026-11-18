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
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg';

/** Optional image model controls forwarded only when the selected model documents them. */
export type ImageModelParameters = {
  resolution?: string;
  tier?: string;
  series?: string;
  seed?: string;
  enablePromptExpansion?: boolean;
  style?: string;
  negativePrompt?: string;
  layerDecomposition?: boolean;
  layerMaxImages?: number;
  layerTextRecognition?: boolean;
  optimizePrompt?: boolean;
  watermark?: boolean;
  safetyIdentifier?: string;
  markupImage?: string;
  outputCompression?: number;
  moderation?: 'auto' | 'low';
  complexity?: 'low' | 'medium' | 'high';
  frameCount?: number;
  frameDurationMs?: number;
  chaos?: number;
  experimentalStyle?: number;
  hd?: boolean;
  referenceImageWeight?: number;
  rawStyle?: boolean;
  referenceMode?: 'image' | 'style' | 'edit' | 'moodboard' | 'editor';
  referenceSlots?: number;
  speed?: 'relax' | 'fast';
  stylize?: number;
  styleWeight?: number;
  weird?: number;
};

export type ImageModelParametersParseResult =
  | { ok: true; value: ImageModelParameters }
  | { ok: false; error: string };

/** Parses the optional, model-specific controls shared by image transports. */
export function parseImageModelParameters(value: unknown): ImageModelParametersParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '图片生成参数格式无效。' };
  }
  const source = value as Record<string, unknown>;
  const result: ImageModelParameters = {};
  const invalid = (label: string): ImageModelParametersParseResult => ({ ok: false, error: `${label}格式无效。` });
  const strings: ReadonlyArray<[keyof ImageModelParameters, string]> = [
    ['resolution', '输出清晰度'], ['tier', '生成档位'], ['series', '图片系列'], ['seed', '随机种子'],
    ['style', '风格偏好'], ['negativePrompt', '排除内容'], ['safetyIdentifier', '安全追踪标识'], ['markupImage', '透明标记图'],
  ];
  for (const [key, label] of strings) {
    const current = source[key];
    if (current === undefined || current === null || current === '') continue;
    if (typeof current !== 'string') return invalid(label);
    if (key === 'resolution') result.resolution = current;
    else if (key === 'tier') result.tier = current;
    else if (key === 'series') result.series = current;
    else if (key === 'seed') result.seed = current;
    else if (key === 'style') result.style = current;
    else if (key === 'negativePrompt') result.negativePrompt = current;
    else if (key === 'safetyIdentifier') result.safetyIdentifier = current;
    else if (key === 'markupImage') result.markupImage = current;
  }

  const booleans: ReadonlyArray<[keyof ImageModelParameters, string]> = [
    ['enablePromptExpansion', '提示词扩写'], ['layerDecomposition', '分层输出'], ['layerTextRecognition', '文字识别'],
    ['optimizePrompt', '提示词优化'], ['watermark', '水印'], ['hd', '原生高清档'], ['rawStyle', '原始风格'],
  ];
  for (const [key, label] of booleans) {
    const current = source[key];
    if (current === undefined || current === null) continue;
    if (typeof current !== 'boolean') return invalid(label);
    if (key === 'enablePromptExpansion') result.enablePromptExpansion = current;
    else if (key === 'layerDecomposition') result.layerDecomposition = current;
    else if (key === 'layerTextRecognition') result.layerTextRecognition = current;
    else if (key === 'optimizePrompt') result.optimizePrompt = current;
    else if (key === 'watermark') result.watermark = current;
    else if (key === 'hd') result.hd = current;
    else if (key === 'rawStyle') result.rawStyle = current;
  }

  const numbers: ReadonlyArray<[keyof ImageModelParameters, string]> = [
    ['layerMaxImages', '分层结果上限'], ['outputCompression', '图片压缩'], ['frameCount', '动画帧数'],
    ['frameDurationMs', '单帧时长'], ['chaos', '画面变化幅度'], ['experimentalStyle', '实验风格强度'],
    ['referenceImageWeight', '参考图影响力'], ['referenceSlots', '参考图槽位数'], ['stylize', '风格化强度'],
    ['styleWeight', '风格权重'], ['weird', '奇异度'],
  ];
  for (const [key, label] of numbers) {
    const current = source[key];
    if (current === undefined || current === null || current === '') continue;
    if (typeof current !== 'number' || !Number.isFinite(current)) return invalid(label);
    if (key === 'layerMaxImages') result.layerMaxImages = current;
    else if (key === 'outputCompression') result.outputCompression = current;
    else if (key === 'frameCount') result.frameCount = current;
    else if (key === 'frameDurationMs') result.frameDurationMs = current;
    else if (key === 'chaos') result.chaos = current;
    else if (key === 'experimentalStyle') result.experimentalStyle = current;
    else if (key === 'referenceImageWeight') result.referenceImageWeight = current;
    else if (key === 'referenceSlots') result.referenceSlots = current;
    else if (key === 'stylize') result.stylize = current;
    else if (key === 'styleWeight') result.styleWeight = current;
    else if (key === 'weird') result.weird = current;
  }

  if (source.moderation !== undefined && source.moderation !== null) {
    if (source.moderation !== 'auto' && source.moderation !== 'low') return invalid('内容审核');
    result.moderation = source.moderation;
  }
  if (source.complexity !== undefined && source.complexity !== null) {
    if (source.complexity !== 'low' && source.complexity !== 'medium' && source.complexity !== 'high') return invalid('构图规划');
    result.complexity = source.complexity;
  }
  if (source.referenceMode !== undefined && source.referenceMode !== null) {
    if (source.referenceMode !== 'image' && source.referenceMode !== 'style' && source.referenceMode !== 'edit'
      && source.referenceMode !== 'moodboard' && source.referenceMode !== 'editor') return invalid('参考图用途');
    result.referenceMode = source.referenceMode;
  }
  if (source.speed !== undefined && source.speed !== null) {
    if (source.speed !== 'relax' && source.speed !== 'fast') return invalid('生成速度');
    result.speed = source.speed;
  }
  return { ok: true, value: result };
}

export type CreativeRoute = {
  lane: CreativeLane;
  operation: CreativeOperation;
  execution: CreativeExecution;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  requiresReference: boolean;
};

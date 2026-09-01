export type ProviderType = 'openai-compatible' | 'google-gemini';
export type ProviderPlatform = 'custom' | '65535' | 'openai' | 'new-api' | 'one-api' | 'openrouter' | 'siliconflow' | 'deepseek' | 'dashscope' | 'volcengine' | 'modelscope' | 'google-gemini' | 'apimart' | 'jimeng-cli' | 'agnes';
export type ProviderStatus = 'healthy' | 'idle' | 'error';
export type UpscaleProviderId = 'tencent-ci' | 'aliyun-viapi';
export type UpscaleModelId = 'tencent-super-resolution' | 'aliyun-standard-super-resolution' | 'aliyun-generative-super-resolution';
export type UpscaleOutputFormat = 'png' | 'jpg' | 'bmp';
export type UpscaleConnectionStatus = 'healthy' | 'idle' | 'error' | 'needs-bucket' | 'needs-authorization';
export type ModelKind = 'chat' | 'image' | 'video' | 'unknown';
export type MediaKind = 'image' | 'video' | 'audio';
export type VideoTransport = 'auto' | 'native-task' | 'openai-videos' | 'jimeng-cli' | 'agnes-videos';
export type ProviderTextProtocol = 'chat-completions' | 'responses' | 'messages';
export type ModelBilling = 'free' | 'paid' | 'temporary-free';
export type WebSearchApiProvider = 'anysearch' | 'baidu-qianfan';
export type NativeSearchProtocol = 'openai-responses' | 'gemini-grounding' | 'native-chat';
export type NativeSearchOverride = 'auto' | 'enabled' | 'disabled';
export type NativeSearchDetection = 'metadata' | 'model-id' | 'provider' | 'manual';
export type WebSearchSource = 'native' | 'external';

export type WebSearchDecisionStatus = 'searched' | 'not-needed' | 'disabled' | 'failed';

export type WebSearchDecisionMeta = {
  mode: 'auto' | 'always' | 'off';
  status: WebSearchDecisionStatus;
  reason?: string;
  query?: string;
};

export type WebSearchMeta = {
  source: WebSearchSource;
  protocol?: NativeSearchProtocol;
  modelId?: string;
  provider?: string;
  query: string;
  resultCount: number;
  fallbackFrom?: 'native';
  searchedAt: string;
};

export type ProviderConnection = {
  id: string;
  name: string;
  type: ProviderType;
  platform?: ProviderPlatform;
  modelLibraryEnabled: boolean;
  baseUrl: string;
  modelsPath?: string;
  chatPath?: string;
  imageGenerationPath?: string;
  imageEditPath?: string;
  imageUpscalePath?: string;
  imageUpscaleStatusPath?: string;
  responsesPath?: string;
  textProtocol?: ProviderTextProtocol;
  videoTransport?: VideoTransport;
  videoBaseUrl?: string;
  videoTaskPath?: string;
  videoTaskStatusPath?: string;
  videoGenerationPath?: string;
  videoQueryPath?: string;
  videoModelsPath?: string;
  videoPricingPath?: string;
  videoApiKeyMasked?: string;
  jimengCliPath?: string;
  jimengCliPollSeconds?: number;
  authHeader?: string;
  authPrefix?: string;
  status: ProviderStatus;
  /** Set only after a real authenticated provider check succeeds. */
  credentialVerifiedAt?: string;
  enabledModelCount: number;
  lastSyncedAt?: string;
  maskedKey?: string;
  createdAt?: string;
};

export type ModelCapability =
  | 'chat'
  | 'vision'
  | 'generate'
  | 'edit'
  | 'reference'
  | 'typography'
  | 'transparent'
  | 'upscale'
  | 'fast'
  | 'web-search'
  | 'video-generate'
  | 'video-edit'
  | 'video-extend'
  | 'video-first-frame'
  | 'video-reference'
  /** The chat model explicitly accepts video input content blocks. */
  | 'video-input'
  | 'video-audio';

export type { CreativeReference, CreativeReferenceKind } from './creative-references';

export type RegistryModel = {
  id: string;
  providerId: string;
  providerName: string;
  rawId: string;
  displayName: string;
  kind: ModelKind;
  enabled: boolean;
  published: boolean;
  capabilities: ModelCapability[];
  billing?: ModelBilling;
  enabledByDefault?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  nativeSearchProtocol?: NativeSearchProtocol;
  nativeSearchOverride?: NativeSearchOverride;
  nativeSearchDetection?: NativeSearchDetection;
};

export type UpscaleConnection = {
  provider: UpscaleProviderId;
  connected: boolean;
  maskedCredential: string;
  status: UpscaleConnectionStatus;
  verifiedAt?: string;
  bucket?: string;
  region?: string;
  errorCode?: string;
};

export type UpscaleModel = {
  id: UpscaleModelId;
  provider: UpscaleProviderId;
  providerId: string;
  providerName: string;
  displayName: string;
  rawId: string;
  description: string;
  detail: string;
  recommendation: string;
  scales: Array<1 | 2 | 3 | 4>;
  outputFormats?: UpscaleOutputFormat[];
  outputQuality?: { min: number; max: number; default: number };
  enabled: boolean;
  published: boolean;
  connected: boolean;
  generative?: boolean;
  links: { open: string; docs: ReadonlyArray<string>; pricing: string };
  capabilities: ModelCapability[];
  kind: 'image';
};

export type AppSettings = {
  agentModelId: string | null;
  defaultImageModelId: string | null;
  defaultVideoModelId?: string | null;
  defaultProviderId: string | null;
  imageStoragePath?: string;
  videoStoragePath?: string;
  webSearchProvider?: WebSearchApiProvider | null;
  webSearchConfigured?: boolean;
  webSearchKeyMasked?: string;
  webSearchAnySearchConfigured?: boolean;
  webSearchQianfanConfigured?: boolean;
};

export type PublicState = {
  providers: ProviderConnection[];
  models: RegistryModel[];
  settings: AppSettings;
  upscaleConnections: UpscaleConnection[];
  upscaleModels: UpscaleModel[];
};

export type GeneratedImage = {
  url: string;
  revisedPrompt?: string;
};

export type GeneratedVideo = {
  url: string;
  revisedPrompt?: string;
  taskId?: string;
  providerTaskId?: string;
  model?: string;
  duration?: number;
  width?: number;
  height?: number;
  localPath?: string;
  providerStatus?: string;
  progress?: number;
};

export type VideoGenerationInput = {
  prompt: string;
  model?: string;
  operation?: 'generate' | 'edit' | 'extend';
  seconds?: number;
  aspectRatio?: string;
  resolution?: string;
  firstFrame?: string;
  lastFrame?: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceVideo?: string;
  audios?: string[];
  audio?: string;
  videoMode?: 'text' | 'keyframe' | 'reference';
  width?: number;
  height?: number;
  numFrames?: number;
  frameRate?: number;
  videoSize?: '720P' | '960P' | '2K';
  referenceVideoStartSeconds?: number;
  referenceVideoEndSeconds?: number;
  requireAudio?: boolean;
};

/** A persisted creative reference used by a generation request or history log. */
export type ReferenceImageRecord = {
  id?: string;
  name: string;
  url: string;
  kind?: 'image' | 'video' | 'text';
  text?: string;
  mimeType?: string;
};

/** Persisted/wire-safe reference record shared by Agent and creative inputs. */
export type CreativeReferenceRecord = import('./creative-references').CreativeReference;

export type ClientReferenceImage = {
  id: string;
  name: string;
  kind?: 'image' | 'video' | 'text';
  dataUrl?: string;
  url?: string;
  text?: string;
  mimeType?: string;
  pending?: boolean;
};

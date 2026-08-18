export type ProviderType = 'openai-compatible' | 'google-gemini';
export type ProviderPlatform = 'custom' | '65535' | 'openai' | 'new-api' | 'one-api' | 'openrouter' | 'siliconflow' | 'deepseek' | 'dashscope' | 'volcengine' | 'modelscope' | 'google-gemini' | 'apimart';
export type ProviderStatus = 'healthy' | 'idle' | 'error';
export type ModelKind = 'chat' | 'image' | 'unknown';
export type WebSearchApiProvider = 'anysearch' | 'baidu-qianfan';

export type ProviderConnection = {
  id: string;
  name: string;
  type: ProviderType;
  platform?: ProviderPlatform;
  baseUrl: string;
  modelsPath?: string;
  chatPath?: string;
  imageGenerationPath?: string;
  imageEditPath?: string;
  imageUpscalePath?: string;
  imageUpscaleStatusPath?: string;
  responsesPath?: string;
  authHeader?: string;
  authPrefix?: string;
  status: ProviderStatus;
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
  | 'web-search';

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
};

export type AppSettings = {
  agentModelId: string | null;
  defaultImageModelId: string | null;
  defaultProviderId: string | null;
  imageStoragePath?: string;
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
};

export type GeneratedImage = {
  url: string;
  revisedPrompt?: string;
};

/** A persisted reference image used by a generation request. */
export type ReferenceImageRecord = {
  id?: string;
  name: string;
  url: string;
};

export type ClientReferenceImage = {
  id: string;
  name: string;
  dataUrl: string;
  pending?: boolean;
};

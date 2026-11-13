export type ProviderTransferProvider = {
  id: string;
  name: string;
  type: string;
  platform: string;
  modelLibraryEnabled: boolean;
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  imageGenerationPath: string;
  imageEditPath: string;
  imageUpscalePath: string;
  imageUpscaleStatusPath: string;
  responsesPath: string;
  textProtocol: string;
  videoTransport: string;
  videoBaseUrl: string;
  videoTaskPath: string;
  videoTaskStatusPath: string;
  videoGenerationPath: string;
  videoQueryPath: string;
  videoModelsPath: string;
  videoPricingPath: string;
  jimengCliPath: string;
  jimengCliPollSeconds?: number;
  authHeader: string;
  authPrefix: string;
  apiKey: string;
  videoApiKey?: string;
};

export type ProviderTransferModel = {
  id: string;
  providerId: string;
  providerName: string;
  rawId: string;
  source?: string;
  displayName: string;
  kind: string;
  enabled: boolean;
  published: boolean;
  capabilities: string[];
  billing?: string;
  enabledByDefault?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  nativeSearchProtocol?: string;
  nativeSearchOverride?: string;
  nativeSearchDetection?: string;
};

export type ProviderTransferBundle = {
  format: 'sanmao-ai-provider-transfer';
  version: 1;
  exportedAt: string;
  providers: ProviderTransferProvider[];
  models: ProviderTransferModel[];
};

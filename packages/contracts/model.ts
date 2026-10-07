/** Provider-neutral model contract. Provider SDKs and HTTP protocols stay in adapters. */

export type ModelCapability =
  | 'text'
  | 'reasoning'
  | 'toolUse'
  | 'structuredOutput'
  | 'vision'
  | 'imageGeneration'
  | 'audio'
  | 'videoInput';

export type ModelCapabilities = {
  text: boolean;
  reasoning: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  vision?: boolean;
  imageGeneration?: boolean;
  audio?: boolean;
  videoInput?: boolean;
};

export type ModelDescriptor = {
  id: string;
  displayName: string;
  capabilities: ModelCapabilities;
};

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export type ModelMessage = {
  role: ModelMessageRole;
  content: string;
};

export type ModelRequest = {
  runId: string;
  messages: readonly ModelMessage[];
  model: ModelDescriptor;
  signal?: AbortSignal;
};

export type ModelResponse = {
  content: string;
  modelId?: string;
};

export interface ModelProvider {
  invoke(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelRuntime {
  descriptor: ModelDescriptor;
  provider: ModelProvider;
  invoke(request: Omit<ModelRequest, 'model'>): Promise<ModelResponse>;
}

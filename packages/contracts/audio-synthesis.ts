/** Synchronous speech generation used by interactive audio creation surfaces. */
export type AudioSynthesisRequest = {
  text: string;
  voice?: string;
  modelId?: string;
  source?: 'workspace' | 'agent' | 'canvas';
  projectId?: string;
  canvasId?: string;
  nodeId?: string;
};

export type AudioSynthesisResult = {
  data: Uint8Array;
  contentType: string;
  extension: string;
  engine: 'provider' | 'offline';
  modelName?: string;
  modelId?: string;
};

export interface AudioSynthesisPort {
  synthesize(input: AudioSynthesisRequest, signal?: AbortSignal): Promise<AudioSynthesisResult>;
}

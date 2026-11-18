import type { SpeechOutputFormat } from '@/packages/contracts/audio-synthesis';

export type CanvasSpeechRequestOptions = {
  text: string;
  voice: string;
  modelId: string;
  format?: SpeechOutputFormat;
  speed?: number;
  preview?: boolean;
  projectId?: string;
  canvasId?: string;
  nodeId: string;
};

export function buildCanvasSpeechRequest(input: CanvasSpeechRequestOptions) {
  return {
    text: input.text,
    ...(input.voice.trim() ? { voice: input.voice.trim() } : {}),
    ...(input.modelId && input.modelId !== 'auto' ? { modelId: input.modelId } : {}),
    ...(input.format ? { format: input.format } : {}),
    ...(input.speed !== undefined ? { speed: input.speed } : {}),
    ...(input.preview ? { preview: true } : {}),
    source: 'canvas' as const,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
    nodeId: input.nodeId,
  };
}

import {
  getSpeechModelAdvancedOptions,
  getSpeechModelProfile,
  getSpeechModelResponseFormats,
  getSpeechModelSpeedRange,
  speechPublicModelId,
  type SpeechOutputFormat,
} from '@/packages/contracts/audio-synthesis';

export type CanvasSpeechRequestOptions = {
  text: string;
  voice: string;
  modelId: string;
  profileModelId?: string;
  providerKey?: string;
  format?: SpeechOutputFormat;
  speed?: number;
  applyTextNormalization?: 'auto' | 'on' | 'off';
  engine?: string;
  languageCode?: string;
  language?: string;
  seed?: number;
  similarityBoost?: number;
  stability?: number;
  voiceId?: string;
  emotion?: string;
  instruct?: string;
  dialogue?: readonly { text: string; voice: string }[];
  preview?: boolean;
  projectId?: string;
  canvasId?: string;
  nodeId: string;
};

export function buildCanvasSpeechRequest(input: CanvasSpeechRequestOptions) {
  const profile = getSpeechModelProfile(input.profileModelId || speechPublicModelId(input.modelId), input.providerKey);
  const formats = profile ? getSpeechModelResponseFormats(profile.publicModel, input.engine, input.providerKey) : undefined;
  const speedRange = profile ? getSpeechModelSpeedRange(profile.publicModel, input.engine, input.providerKey) : undefined;
  const advancedOptions = getSpeechModelAdvancedOptions(profile?.publicModel || '', input, input.providerKey);
  return {
    text: input.text,
    ...(input.voice.trim() && !input.voiceId?.trim() && !(profile?.supportsDialogue || profile?.requiresVoiceId) ? { voice: input.voice.trim() } : {}),
    ...(input.modelId && input.modelId !== 'auto' ? { modelId: input.modelId } : {}),
    ...(input.format && (!formats || formats.includes(input.format)) ? { format: input.format } : {}),
    ...(input.speed !== undefined && (!profile || speedRange) ? { speed: input.speed } : {}),
    ...advancedOptions,
    ...(input.preview ? { preview: true } : {}),
    source: 'canvas' as const,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
    nodeId: input.nodeId,
  };
}

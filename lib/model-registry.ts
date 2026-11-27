import type { ModelCapability, ModelKind, NativeSearchDetection, NativeSearchProtocol, RegistryModel } from './types';
import type { AudioModelClassification } from '@/packages/contracts/model-classification';

type InferredModel = {
  kind: ModelKind;
  capabilities: ModelCapability[];
  classification?: AudioModelClassification;
  nativeSearchProtocol?: NativeSearchProtocol;
  nativeSearchDetection?: NativeSearchDetection;
};

const AUDIO_TASK_CAPABILITIES = new Set<ModelCapability>([
  'speech', 'transcription', 'music-generate', 'sound-effect', 'audio-conversation',
]);
const IMAGE_TASK_CAPABILITIES = new Set<ModelCapability>([
  'generate', 'edit', 'reference', 'typography', 'transparent', 'upscale',
]);

/** Replace discovered task capabilities with the latest provider snapshot. */
export function reconcileDiscoveredModelCapabilities(previous: RegistryModel, latest: readonly ModelCapability[]) {
  const explicitChatOnly = latest.includes('chat') && !latest.some((capability) => IMAGE_TASK_CAPABILITIES.has(capability));
  const retained = previous.source === 'manual'
    ? previous.capabilities
    : previous.capabilities.filter((capability) => !AUDIO_TASK_CAPABILITIES.has(capability)
      && !(explicitChatOnly && IMAGE_TASK_CAPABILITIES.has(capability)));
  return Array.from(new Set([...retained, ...latest]));
}

export function buildManualModelRecord(input: {
  id: string;
  providerId: string;
  providerName: string;
  rawId: string;
  displayName: string;
  kind: ModelKind;
  inferred: InferredModel;
}) {
  const capabilities = new Set<ModelCapability>(input.inferred.capabilities);
  if (input.kind === 'chat') {
    capabilities.add('chat');
    capabilities.add('vision');
  } else if (input.kind === 'image') {
    capabilities.add('generate');
  } else if (input.kind === 'video') {
    capabilities.add('video-generate');
  } else if (input.kind === 'audio') {
    // An audio type alone does not establish its task. Leave unknown models
    // without a routable capability until the provider or user identifies it.
  } else if (input.kind === '3d') {
    capabilities.add('3d-generate');
  }
  const audioPurpose = capabilities.has('speech') ? 'speech'
    : capabilities.has('transcription') ? 'transcription'
      : capabilities.has('sound-effect') ? 'sound-effect'
        : capabilities.has('music-generate') ? 'music'
          : capabilities.has('audio-conversation') ? 'conversation'
            : null;
  const classification: AudioModelClassification | undefined = input.kind === 'audio'
    ? input.inferred.classification || {
        purposes: audioPurpose ? [audioPurpose] : [],
        source: 'manual' as const,
        confidence: audioPurpose ? 'high' as const : 'low' as const,
        evidence: [{ kind: 'manual' as const, value: audioPurpose ? '用户手动选择模型用途' : '仅确认模型属于音频，具体用途待确认' }],
        requiresReview: !audioPurpose,
      }
    : input.inferred.classification;
  return {
    id: input.id,
    providerId: input.providerId,
    providerName: input.providerName,
    rawId: input.rawId,
    source: 'manual' as const,
    displayName: input.displayName,
    kind: input.kind,
    enabled: false,
    published: false,
    capabilities: [...capabilities],
    ...(classification ? { classification } : {}),
    ...(input.inferred.nativeSearchProtocol ? { nativeSearchProtocol: input.inferred.nativeSearchProtocol } : {}),
    ...(input.inferred.nativeSearchDetection ? { nativeSearchDetection: input.inferred.nativeSearchDetection } : {}),
  } satisfies RegistryModel;
}

/** Keep manually registered models across an upstream refresh and enforce one record per raw model ID. */
export function mergeProviderModelRecords(existing: RegistryModel[], discovered: RegistryModel[]) {
  const existingByRawId = new Map<string, RegistryModel>();
  for (const model of existing) if (model.rawId && !existingByRawId.has(model.rawId)) existingByRawId.set(model.rawId, model);
  const byRawId = new Map<string, RegistryModel>();
  for (const model of discovered) {
    if (!model.rawId || byRawId.has(model.rawId)) continue;
    const previous = existingByRawId.get(model.rawId);
    byRawId.set(model.rawId, previous ? {
      ...model,
      id: previous.id,
      source: previous.source === 'manual' ? 'manual' : model.source || previous.source,
      enabled: previous.enabled,
      published: previous.published,
    } : model);
  }
  for (const model of existing) {
    if (model.source === 'manual' && model.rawId && !byRawId.has(model.rawId)) byRawId.set(model.rawId, model);
  }
  return [...byRawId.values()];
}

import type { ModelCapability, ModelKind, NativeSearchDetection, NativeSearchProtocol, RegistryModel } from './types';
import type { AudioModelClassification } from '@/packages/contracts/model-classification';

type InferredModel = {
  kind: ModelKind;
  capabilities: ModelCapability[];
  classification?: AudioModelClassification;
  nativeSearchProtocol?: NativeSearchProtocol;
  nativeSearchDetection?: NativeSearchDetection;
};

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
    if (!capabilities.has('music-generate') && !capabilities.has('sound-effect') && !capabilities.has('transcription') && !capabilities.has('speech')) capabilities.add('speech');
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
    ? {
        purposes: audioPurpose ? [audioPurpose] : [],
        source: 'manual' as const,
        confidence: 'high' as const,
        evidence: [{ kind: 'manual' as const, value: '用户手动选择模型用途' }],
        requiresReview: false,
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

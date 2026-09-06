import type { ModelCapability, ModelKind, NativeSearchDetection, NativeSearchProtocol, RegistryModel } from './types';

type InferredModel = {
  kind: ModelKind;
  capabilities: ModelCapability[];
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
  }
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

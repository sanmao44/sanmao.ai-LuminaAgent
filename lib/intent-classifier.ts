import type { RegistryModel } from './types';

/**
 * JEV is a routing model in this application. It must not be offered as a
 * normal conversation model, even though the provider catalog reports it as
 * a chat model.
 */
export const INTENT_CLASSIFIER_MODEL_RAW_ID = 'jev-1.14';
const LEGACY_INTENT_CLASSIFIER_MODEL_RAW_IDS = ['jev-1.13'] as const;
const INTERNAL_INTENT_MODEL_RAW_IDS = [INTENT_CLASSIFIER_MODEL_RAW_ID, ...LEGACY_INTENT_CLASSIFIER_MODEL_RAW_IDS] as const;

/** Older router releases stay hidden from user-selected chat models. */
export function isInternalIntentModel(model: Pick<RegistryModel, 'rawId'> | null | undefined) {
  const rawId = String(model?.rawId || '').trim().toLowerCase();
  return INTERNAL_INTENT_MODEL_RAW_IDS
    .some((modelId) => rawId === modelId || rawId.endsWith(`/${modelId}`));
}

/** New catalog entries for the internal router are active by default. */
export function isIntentClassifierEnabledByDefault(rawId: string, explicit?: boolean) {
  return explicit === true || isIntentClassifierModel({ rawId });
}

export function isIntentClassifierModel(model: Pick<RegistryModel, 'rawId'> | null | undefined) {
  const rawId = String(model?.rawId || '').trim().toLowerCase();
  return rawId === INTENT_CLASSIFIER_MODEL_RAW_ID || rawId.endsWith(`/${INTENT_CLASSIFIER_MODEL_RAW_ID}`);
}

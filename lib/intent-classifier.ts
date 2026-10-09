import type { RegistryModel } from './types';

/**
 * JEV is a routing model in this application. It must not be offered as a
 * normal conversation model, even though the provider catalog reports it as
 * a chat model.
 */
export const INTENT_CLASSIFIER_MODEL_RAW_ID = 'jev-1.13';

export function isIntentClassifierModel(model: Pick<RegistryModel, 'rawId'> | null | undefined) {
  const rawId = String(model?.rawId || '').trim().toLowerCase();
  return rawId === INTENT_CLASSIFIER_MODEL_RAW_ID || rawId.endsWith(`/${INTENT_CLASSIFIER_MODEL_RAW_ID}`);
}

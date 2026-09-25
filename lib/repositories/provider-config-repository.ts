import { getPublicState } from '../store';
import type { ProviderConfigRepository } from './types';

/** Server-side provider configuration boundary; secrets never cross this API. */
export const providerConfigRepository: ProviderConfigRepository = {
  getPublicState,
};

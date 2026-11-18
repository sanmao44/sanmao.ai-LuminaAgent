import type { PublicState, RegistryModel } from '@/lib/types';
import { isCangyuanProvider } from '@/lib/cangyuan-provider';
import { filterModelsByActiveProviders } from '@/lib/provider-availability';

const CANGYUAN_NON_TTS_MODELS = new Set(['mu1-muse-asr']);

export function supportedSpeechModels(state: PublicState | null): RegistryModel[] {
  if (!state) return [];

  const activeSpeechModels = filterModelsByActiveProviders(state.models, state.providers, { capability: 'speech' });
  const cangyuanProviderIds = new Set(state.providers.filter(isCangyuanProvider).map((provider) => provider.id));

  return activeSpeechModels.filter((model) =>
    !cangyuanProviderIds.has(model.providerId) || !CANGYUAN_NON_TTS_MODELS.has(model.rawId.trim().toLowerCase()));
}

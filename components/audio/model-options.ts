import type { PublicState, RegistryModel } from '@/lib/types';
import { filterModelsByActiveProviders } from '@/lib/provider-availability';
import { isAudioTranscriptionModelId } from '@/lib/model-kind';

function openAiCompatibleModels(state: PublicState | null, capability: RegistryModel['capabilities'][number]) {
  if (!state) return [];
  const providers = state.providers.filter((provider) => provider.type === 'openai-compatible');
  return filterModelsByActiveProviders(state.models, providers, { capability });
}

export function supportedSpeechModels(state: PublicState | null) {
  return openAiCompatibleModels(state, 'speech').filter((model) =>
    !model.capabilities.includes('transcription') && !isAudioTranscriptionModelId(model.rawId));
}

export function supportedTranscriptionModels(state: PublicState | null) {
  return openAiCompatibleModels(state, 'transcription');
}


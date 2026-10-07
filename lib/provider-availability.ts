import type { ProviderConnection, RegistryModel } from './types';

type ProviderAvailability = Pick<ProviderConnection, 'id' | 'modelLibraryEnabled'>;

/** Legacy provider records omitted the flag and remain enabled by default. */
export function isProviderModelLibraryEnabled(provider: Pick<ProviderConnection, 'modelLibraryEnabled'> | null | undefined) {
  return provider?.modelLibraryEnabled !== false;
}

export function activeProviderIds(providers: ProviderAvailability[]) {
  return new Set(providers.filter(isProviderModelLibraryEnabled).map((provider) => provider.id));
}

export function filterModelsByActiveProviders(models: RegistryModel[], providers: ProviderAvailability[]) {
  const activeIds = activeProviderIds(providers);
  return models.filter((model) => activeIds.has(model.providerId));
}

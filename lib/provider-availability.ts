import type { ModelCapability, ModelKind, ProviderConnection, RegistryModel } from './types';

type ProviderAvailability = Pick<ProviderConnection, 'id' | 'modelLibraryEnabled'>;

/** Legacy provider records omitted the flag and remain enabled by default. */
export function isProviderModelLibraryEnabled(provider: Pick<ProviderConnection, 'modelLibraryEnabled'> | null | undefined) {
  return provider?.modelLibraryEnabled !== false;
}

export function activeProviderIds(providers: ProviderAvailability[]) {
  return new Set(providers.filter(isProviderModelLibraryEnabled).map((provider) => provider.id));
}

export function filterModelsByActiveProviders(
  models: RegistryModel[],
  providers: ProviderAvailability[],
  options?: { kind?: ModelKind; capability?: ModelCapability },
) {
  const activeIds = activeProviderIds(providers);
  return models.filter((model) => {
    if (!activeIds.has(model.providerId)) return false;
    if (!options) return true;
    return model.enabled
      && model.published
      && (options.kind === undefined || model.kind === options.kind)
      && (options.capability === undefined || model.capabilities.includes(options.capability));
  });
}

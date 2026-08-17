type SelectableModel = {
  id: string;
  providerId: string;
};

export function selectAutomaticModel<T extends SelectableModel>(
  models: T[],
  defaultProviderId?: string | null,
  defaultModelId?: string | null,
) {
  const providerModels = defaultProviderId
    ? models.filter((model) => model.providerId === defaultProviderId)
    : [];

  return providerModels.find((model) => model.id === defaultModelId)
    || providerModels[0]
    || models.find((model) => model.id === defaultModelId)
    || models[0];
}

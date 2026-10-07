type SelectableModel = {
  id: string;
  providerId: string;
};

export function selectAutomaticModel<T extends SelectableModel>(
  models: T[],
  defaultProviderId?: string | null,
  defaultModelId?: string | null,
) {
  // The explicitly configured model is the user's strongest preference.
  // The provider preference is only a fallback when that model is unavailable.
  const configuredModel = defaultModelId
    ? models.find((model) => model.id === defaultModelId)
    : undefined;
  if (configuredModel) return configuredModel;

  const providerModels = defaultProviderId
    ? models.filter((model) => model.providerId === defaultProviderId)
    : [];

  return providerModels[0] || models[0];
}

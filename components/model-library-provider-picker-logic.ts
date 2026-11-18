export type ModelLibraryProviderOption = {
  id: string;
  name: string;
  availableModelCount: number;
};

export function filterModelLibraryProviders(providers: ModelLibraryProviderOption[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return providers;
  return providers.filter((provider) => `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedQuery));
}

export function nextModelLibraryProviderValue(values: string[], current: string, direction: 1 | -1) {
  if (!values.length) return current;
  const currentIndex = values.indexOf(current);
  const nextIndex = (Math.max(0, currentIndex) + direction + values.length) % values.length;
  return values[nextIndex];
}

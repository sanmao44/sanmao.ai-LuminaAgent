import type { RegistryModel } from './types';

export const MODEL_PICKER_QUICK_LIMIT = 4;

export function modelPickerMatches(model: RegistryModel, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return `${model.displayName} ${model.rawId} ${model.providerName}`.toLowerCase().includes(normalizedQuery);
}

export function uniqueRegistryModels(models: Array<RegistryModel | null | undefined>) {
  return [...new Map(
    models
      .filter((model): model is RegistryModel => Boolean(model))
      .map((model) => [model.id, model]),
  ).values()];
}

export function takeUniqueModelSlice(
  models: RegistryModel[],
  seen: Set<string>,
  limit = MODEL_PICKER_QUICK_LIMIT,
) {
  const result: RegistryModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
    if (result.length >= limit) break;
  }
  return result;
}

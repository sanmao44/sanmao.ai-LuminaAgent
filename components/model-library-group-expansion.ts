export type ModelLibraryGroupFilters = {
  search: string;
  provider: string;
  kind: string;
  quick: string;
};

export type ModelLibraryGroupExpansion = {
  filterKey: string;
  overrides: ReadonlyMap<string, boolean>;
};

function filterKey(filters: ModelLibraryGroupFilters): string {
  return JSON.stringify([filters.search.trim().toLowerCase(), filters.provider, filters.kind, filters.quick]);
}

export function resetModelLibraryGroupExpansion(
  expansion: ModelLibraryGroupExpansion,
  filters: ModelLibraryGroupFilters,
): ModelLibraryGroupExpansion {
  const key = filterKey(filters);
  return expansion.filterKey === key ? expansion : { filterKey: key, overrides: new Map() };
}

export function isModelLibraryGroupExpanded(
  providerId: string,
  filters: ModelLibraryGroupFilters,
  expandedProviders: ReadonlySet<string>,
  expansion: ModelLibraryGroupExpansion,
): boolean {
  const override = expansion.filterKey === filterKey(filters) ? expansion.overrides.get(providerId) : undefined;
  if (override !== undefined) return override;
  return Boolean(filters.search.trim()) || filters.quick !== 'all' || filters.provider !== 'all' || expandedProviders.has(providerId);
}

/** Explicit group choices apply to the current filtered view, including a collapsed choice. */
export function toggleModelLibraryGroupExpansion(
  expansion: ModelLibraryGroupExpansion,
  providerId: string,
  filters: ModelLibraryGroupFilters,
  expandedProviders: ReadonlySet<string>,
): ModelLibraryGroupExpansion {
  const key = filterKey(filters);
  const overrides = new Map(expansion.filterKey === key ? expansion.overrides : []);
  overrides.set(providerId, !isModelLibraryGroupExpanded(providerId, filters, expandedProviders, expansion));
  return { filterKey: key, overrides };
}

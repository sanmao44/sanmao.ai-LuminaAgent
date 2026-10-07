import { createSqliteAuthorityFence, readSqliteRecord } from '../database/sqlite';
import type { StoreData } from '../store';

const assertStoreStable = createSqliteAuthorityFence();

/** Read-only settings projection for media adapters; secrets stay encrypted. */
export function readAuthoritativeProviderSettings() {
  assertStoreStable();
  const stored = readSqliteRecord<Partial<StoreData>>('provider-config', 'primary');
  if (stored?.settings && typeof stored.settings === 'object') return stored.settings as Record<string, unknown>;
  return null;
}


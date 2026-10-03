import { isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { StoreData } from '../store';

/** Server provider state persistence boundary. Secrets remain encrypted in DTOs. */
export function readAuthoritativeProviderState() {
  return isSqliteActive() ? readSqliteRecord<Partial<StoreData>>('provider-config', 'primary') : null;
}

export function writeAuthoritativeProviderState(value: StoreData) {
  if (!isSqliteActive()) return false;
  writeSqliteRecord('provider-config', 'primary', value);
  return true;
}

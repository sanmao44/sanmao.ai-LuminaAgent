import { isSqliteActive, readSqliteRecord, writeSqliteRecord } from '../database/sqlite';
import type { WorkspaceSnapshot } from '../workspace-types';

export type StoredWorkspaceSnapshot = WorkspaceSnapshot & { revision?: number };

/** Server persistence boundary for the workspace API. */
export function readAuthoritativeWorkspace(dataDir: string) {
  return isSqliteActive(dataDir)
    ? readSqliteRecord<StoredWorkspaceSnapshot>('workspace', 'primary', dataDir)
    : null;
}

export function writeAuthoritativeWorkspace(dataDir: string, workspace: StoredWorkspaceSnapshot) {
  if (!isSqliteActive(dataDir)) return false;
  writeSqliteRecord('workspace', 'primary', workspace, dataDir);
  return true;
}

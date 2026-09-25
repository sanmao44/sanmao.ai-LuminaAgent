import type { PublicState } from '../types';
import type { WorkspaceSnapshot } from '../workspace-types';
import type { AssetRecord } from '../assets';

/** Stable application-facing boundaries. Implementations may remain JSON or IndexedDB. */
export type WorkspaceRepository = {
  bootstrap(): Promise<{ offline: boolean }>;
  collect(): Promise<WorkspaceSnapshot>;
  restore(snapshot: WorkspaceSnapshot): Promise<void>;
};

export type ProviderConfigRepository = {
  getPublicState(): Promise<PublicState>;
};

export type AssetRepository = {
  list(extra?: AssetRecord[]): Promise<AssetRecord[]>;
};

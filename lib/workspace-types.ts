import type { AssetCollection, AssetIndexItem, ChatSession, GalleryItem } from './client-history';
import type { CanvasDocument, CanvasProject } from './canvas/types';
import { WORKSPACE_SCHEMA_VERSION } from './workspace-format';
export { WORKSPACE_SCHEMA_VERSION };


export type CanvasWorkspaceData = {
  projects: CanvasProject[];
  activeId: string | null;
  documents: Record<string, CanvasDocument>;
  ui: Record<string, unknown>;
};

export type WorkspacePreferences = Record<string, string>;

export type WorkspaceSnapshot = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  updatedAt: number;
  clientId: string;
  canvas: CanvasWorkspaceData;
  gallery: GalleryItem[];
  chatSessions: ChatSession[];
  assetIndex: AssetIndexItem[];
  assetCollections: AssetCollection[];
  preferences: WorkspacePreferences;
};

export type WorkspaceEnvelope = {
  ok: true;
  workspace: WorkspaceSnapshot | null;
  updatedAt: number | null;
};

'use client';

import {
  DEFAULT_ASSET_COLLECTIONS,
  listAssetCollections,
  listAssetIndex,
  listChatSessions,
  listGallery,
  replaceAssetIndexItems,
  replaceChatSessions,
  replaceGalleryItems,
  saveAssetCollections,
  type AssetCollection,
  type AssetIndexItem,
  type ChatSession,
  type GalleryItem,
} from './client-history';
import {
  readCanvasWorkspace,
  restoreCanvasWorkspace,
} from './canvas/storage';
import {
  WORKSPACE_CHANGE_EVENT,
  withWorkspaceRestoreSuppressedAsync,
} from './workspace-events';
import {
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceSnapshot,
} from './workspace-types';
import {
  validateWorkspaceShape,
  workspaceContentSignature,
  workspaceHasData,
} from './workspace-format';
import { readWorkspaceContext } from './workspace-context';

const META_KEY = 'sanmao.workspace.sync.meta.v1';
const CLIENT_ID_KEY = 'sanmao.workspace.client-id.v1';
const SYNC_INTERVAL_MS = 5000;
const SYNC_DEBOUNCE_MS = 700;
const MAX_WORKSPACE_BYTES = 80 * 1024 * 1024;

export const WORKSPACE_PREFERENCE_KEYS = [
  'sanmao-theme',
  'sanmao-success-sound',
  'sanmao-agent-web-mode',
  'sanmao-agent-web-search',
  'sanmao-history-page-size',
  'sanmao-generate-settings',
  'sanmao-generate-tasks',
  'sanmao-creation-defaults-v2',
  'sanmao-model-preferences',
  'sanmao-angle-settings',
  'sanmao.canvas.settings',
  'sanmao.canvas.topbar.collapsed',
  'sanmao.canvas.deck.collapsed',
  'sanmao.canvas.minimap.collapsed.v2',
] as const;

export type WorkspaceSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict';

type WorkspaceMeta = {
  clientId: string;
  localUpdatedAt: number;
  serverUpdatedAt: number;
  pending: boolean;
  revision?: number;
  contentHash?: string;
  contentSignature?: string;
};

type WorkspaceSyncOptions = {
  onStatus?: (status: WorkspaceSyncStatus) => void;
};

type WorkspaceServerResponse = {
  workspace?: WorkspaceSnapshot | null;
  updatedAt?: number | null;
  revision?: number;
  contentHash?: string | null;
};

class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
}

let syncOwner: symbol | null = null;
let bootstrapPromise: Promise<{ offline: boolean }> | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readMeta(): WorkspaceMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(META_KEY) || 'null');
    if (!isObject(value) || typeof value.clientId !== 'string') return null;
    return {
      clientId: value.clientId,
      localUpdatedAt: Number(value.localUpdatedAt) || 0,
      serverUpdatedAt: Number(value.serverUpdatedAt) || 0,
      pending: Boolean(value.pending),
      revision: Number.isInteger(Number(value.revision)) ? Math.max(0, Number(value.revision)) : 0,
      contentHash: typeof value.contentHash === 'string' ? value.contentHash : undefined,
      contentSignature: typeof value.contentSignature === 'string' ? value.contentSignature : undefined,
    };
  } catch { return null; }
}

function clientId() {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const value = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, value);
    return value;
  } catch { return `browser-${Date.now().toString(36)}`; }
}

function writeMeta(value: WorkspaceMeta) {
  try { window.localStorage.setItem(META_KEY, JSON.stringify(value)); } catch {}
}

function readPreferences() {
  const preferences: Record<string, string> = {};
  for (const key of WORKSPACE_PREFERENCE_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) preferences[key] = value;
    } catch {}
  }
  return preferences;
}

export async function collectWorkspaceSnapshot(updatedAt = Date.now()): Promise<WorkspaceSnapshot> {
  const [gallery, chatSessions, assetIndex, assetCollections] = await Promise.all([
    listGallery().catch(() => [] as GalleryItem[]),
    listChatSessions().catch(() => [] as ChatSession[]),
    listAssetIndex().catch(() => [] as AssetIndexItem[]),
    listAssetCollections().catch(() => DEFAULT_ASSET_COLLECTIONS as AssetCollection[]),
  ]);
  const legacyChatProjectId = readWorkspaceContext().creativeProjectId;
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt,
    clientId: clientId(),
    canvas: readCanvasWorkspace(),
    gallery,
    chatSessions: chatSessions.map((session) => session.projectId ? session : { ...session, projectId: legacyChatProjectId }),
    assetIndex,
    assetCollections,
    preferences: readPreferences(),
  };
}

async function requestWorkspace(method: 'GET' | 'PUT', workspace?: WorkspaceSnapshot, keepalive = false, expectedRevision?: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const payload = workspace && expectedRevision !== undefined ? { workspace, expectedRevision } : workspace ? { workspace } : undefined;
    const body = payload ? JSON.stringify(payload) : undefined;
    if (body && new TextEncoder().encode(body).byteLength > MAX_WORKSPACE_BYTES) throw new Error('工作区数据超过 80MB，暂时无法同步');
    const response = await fetch('/api/workspace', {
      method,
      cache: 'no-store',
      signal: controller.signal,
      keepalive,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
    });
    const data = await response.json().catch(() => ({})) as WorkspaceServerResponse & { error?: string; code?: string };
    if (!response.ok && (data.code === 'WORKSPACE_CONFLICT' || response.status === 409)) throw new WorkspaceConflictError(data.error || '工作区已被其他窗口更新，请刷新后再保存');
    if (!response.ok) throw new Error(data.error || '读取工作区失败');
    return data;
  } finally { window.clearTimeout(timeoutId); }
}

export async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  await withWorkspaceRestoreSuppressedAsync(async () => {
    if (!restoreCanvasWorkspace(snapshot.canvas)) throw new Error('恢复画布失败');
    await replaceGalleryItems(snapshot.gallery);
    await replaceChatSessions(snapshot.chatSessions);
    await replaceAssetIndexItems(snapshot.assetIndex);
    await saveAssetCollections(snapshot.assetCollections);
    for (const key of WORKSPACE_PREFERENCE_KEYS) {
      try { window.localStorage.removeItem(key); } catch {}
    }
    for (const [key, value] of Object.entries(snapshot.preferences)) {
      if (!(WORKSPACE_PREFERENCE_KEYS as readonly string[]).includes(key) || typeof value !== 'string') continue;
      try { window.localStorage.setItem(key, value); } catch {}
    }
    // A restored snapshot is the new baseline. Without resetting this
    // metadata, a stale pre-restore browser cache can win the next bootstrap
    // comparison and overwrite the freshly restored server workspace.
    writeMeta({
      clientId: clientId(),
      localUpdatedAt: snapshot.updatedAt,
      serverUpdatedAt: snapshot.updatedAt,
      pending: false,
      contentSignature: workspaceContentSignature(snapshot),
    });
  });
}

async function saveWorkspace(snapshot: WorkspaceSnapshot, meta: WorkspaceMeta) {
  const data = await requestWorkspace('PUT', snapshot, false, meta.revision ?? 0);
  const serverUpdatedAt = Number(data.updatedAt || snapshot.updatedAt);
  const revision = Number(data.revision ?? (meta.revision ?? 0) + 1);
  const current = readMeta() || meta;
  writeMeta({
    ...current,
    clientId: snapshot.clientId,
    serverUpdatedAt,
    revision,
    contentHash: data.contentHash || undefined,
    pending: current.localUpdatedAt > snapshot.updatedAt,
    contentSignature: workspaceContentSignature(snapshot),
  });
  return serverUpdatedAt;
}

/** Reconciles the browser cache with the local service before the page renders its data. */
export async function bootstrapWorkspace() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = bootstrapWorkspaceInternal();
  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

async function bootstrapWorkspaceInternal() {
  const local = await collectWorkspaceSnapshot();
  const previous = readMeta();
  const currentMeta: WorkspaceMeta = previous || {
    clientId: local.clientId,
    localUpdatedAt: 0,
    serverUpdatedAt: 0,
    pending: false,
  };
  try {
    const server = await requestWorkspace('GET');
    const remote = server.workspace ? validateWorkspaceShape(server.workspace) as unknown as WorkspaceSnapshot : null;
    const remoteRevision = Number(server.revision ?? 0);
    if (remote && currentMeta.pending && currentMeta.localUpdatedAt > remote.updatedAt) {
      const pending = { ...local, updatedAt: currentMeta.localUpdatedAt };
      await saveWorkspace(pending, { ...currentMeta, revision: remoteRevision, localUpdatedAt: pending.updatedAt, pending: true });
    } else if (remote) {
      await restoreWorkspaceSnapshot(remote);
      writeMeta({ clientId: local.clientId, localUpdatedAt: remote.updatedAt, serverUpdatedAt: remote.updatedAt, revision: remoteRevision, contentHash: server.contentHash || undefined, pending: false, contentSignature: workspaceContentSignature(remote) });
    } else if (workspaceHasData(local)) {
      const migrated = { ...local, updatedAt: Math.max(Date.now(), currentMeta.localUpdatedAt) };
      await saveWorkspace(migrated, { ...currentMeta, localUpdatedAt: migrated.updatedAt, pending: true });
    } else {
      writeMeta({ ...currentMeta, clientId: local.clientId, revision: remoteRevision, pending: false });
    }
    return { offline: false };
  } catch {
    writeMeta({ ...currentMeta, clientId: local.clientId, pending: currentMeta.pending || workspaceHasData(local) });
    return { offline: true };
  }
}

export function startWorkspaceSync(options: WorkspaceSyncOptions = {}) {
  if (typeof window === 'undefined' || syncOwner) return () => {};
  const owner = Symbol('workspace-sync');
  syncOwner = owner;
  let stopped = false;
  let timer: number | null = null;
  let retryTimer: number | null = null;
  let syncing = false;
  const setStatus = (status: WorkspaceSyncStatus) => options.onStatus?.(status);

  const reconcile = async () => {
    if (stopped || syncing) return;
    syncing = true;
    setStatus('syncing');
    try {
      const local = await collectWorkspaceSnapshot();
      const meta = readMeta() || { clientId: local.clientId, localUpdatedAt: 0, serverUpdatedAt: 0, pending: false };
      const data = await requestWorkspace('GET');
      const remote = data.workspace ? validateWorkspaceShape(data.workspace) as unknown as WorkspaceSnapshot : null;
      const remoteRevision = Number(data.revision ?? 0);
      const localSignature = workspaceContentSignature(local);
      const signatureChanged = Boolean(meta.contentSignature) && meta.contentSignature !== localSignature;
      const localDirty = meta.pending || signatureChanged;
      const localUpdatedAt = localDirty ? Math.max(meta.localUpdatedAt, signatureChanged ? Date.now() : 0) : 0;
      if (signatureChanged && !meta.pending) writeMeta({ ...meta, localUpdatedAt, pending: true });
      if (remote && localDirty && localUpdatedAt > remote.updatedAt) {
        await saveWorkspace({ ...local, updatedAt: localUpdatedAt }, { ...meta, revision: remoteRevision, localUpdatedAt, pending: true });
      } else if (remote && remote.updatedAt > meta.serverUpdatedAt) {
        await restoreWorkspaceSnapshot(remote);
        writeMeta({ clientId: local.clientId, localUpdatedAt: remote.updatedAt, serverUpdatedAt: remote.updatedAt, revision: remoteRevision, contentHash: data.contentHash || undefined, pending: false, contentSignature: workspaceContentSignature(remote) });
      } else if (workspaceHasData(local)) {
        if (!meta.serverUpdatedAt || localDirty) {
          const next = { ...local, updatedAt: Math.max(localUpdatedAt, Date.now()) };
          await saveWorkspace(next, { ...meta, localUpdatedAt: next.updatedAt, pending: true });
        }
      }
      if (!readMeta()?.contentSignature && remote) writeMeta({ ...meta, serverUpdatedAt: remote.updatedAt, revision: remoteRevision, contentHash: data.contentHash || undefined, contentSignature: workspaceContentSignature(remote) });
      setStatus('synced');
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        setStatus('conflict');
        return;
      }
      setStatus('offline');
      retryTimer = window.setTimeout(() => void reconcile(), SYNC_INTERVAL_MS);
    } finally { syncing = false; }
  };

  const push = async (keepalive = false) => {
    if (stopped || syncing) return;
    const before = readMeta();
    if (!before?.pending && !keepalive) return;
    syncing = true;
    setStatus('syncing');
    try {
      const local = await collectWorkspaceSnapshot(before?.localUpdatedAt || Date.now());
      const meta = readMeta() || { clientId: local.clientId, localUpdatedAt: local.updatedAt, serverUpdatedAt: 0, pending: true };
      const data = await requestWorkspace('PUT', local, keepalive, meta.revision ?? 0);
      const current = readMeta() || meta;
      writeMeta({ ...current, clientId: local.clientId, serverUpdatedAt: local.updatedAt, revision: Number(data.revision ?? (meta.revision ?? 0) + 1), contentHash: data.contentHash || undefined, pending: current.localUpdatedAt > local.updatedAt, contentSignature: workspaceContentSignature(local) });
      setStatus(current.localUpdatedAt > local.updatedAt ? 'offline' : 'synced');
    } catch (error) {
      const current = readMeta();
      if (current) writeMeta({ ...current, pending: true });
      setStatus(error instanceof WorkspaceConflictError ? 'conflict' : 'error');
    } finally { syncing = false; }
  };

  const markDirty = () => {
    const meta = readMeta() || { clientId: clientId(), localUpdatedAt: 0, serverUpdatedAt: 0, pending: false };
    writeMeta({ ...meta, localUpdatedAt: Date.now(), pending: true });
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(), SYNC_DEBOUNCE_MS);
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') void push(true);
  };
  const handlePageHide = () => { void push(true); };
  const periodic = () => {
    void reconcile();
  };

  window.addEventListener(WORKSPACE_CHANGE_EVENT, markDirty);
  window.addEventListener('online', reconcile);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  const interval = window.setInterval(periodic, SYNC_INTERVAL_MS);
  void reconcile();

  return () => {
    if (syncOwner !== owner) return;
    stopped = true;
    syncOwner = null;
    if (timer) window.clearTimeout(timer);
    if (retryTimer) window.clearTimeout(retryTimer);
    window.clearInterval(interval);
    window.removeEventListener(WORKSPACE_CHANGE_EVENT, markDirty);
    window.removeEventListener('online', reconcile);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
  };
}

'use client';

import {
  listChatSessions,
  replaceChatSessions,
} from './client-history';
import {
  readCanvasWorkspace,
  restoreCanvasWorkspace,
} from './canvas/storage';
import {
  WORKSPACE_CHANGE_EVENT,
  emitWorkspaceMutation,
  getWorkspaceMutationGeneration,
  hasWorkspaceDraftPending,
  withWorkspaceRestoreSuppressed,
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
import { assetRepository } from './repositories/asset-repository';

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
  onRestored?: () => void;
};

type WorkspaceServerResponse = {
  workspace?: WorkspaceSnapshot | null;
  updatedAt?: number | null;
  revision?: number;
  contentHash?: string | null;
};

type WorkspaceMetadataResponse = {
  updatedAt?: number | null;
  revision?: number;
};

class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
}

let syncOwner: symbol | null = null;
let bootstrapPromise: Promise<{ offline: boolean }> | null = null;
// This is sync bookkeeping, never a second document owner. Events are counted
// even before bootstrap / the sync listener is mounted.
let acknowledgedMutationGeneration = 0;
let explicitRestoreGeneration = 0;

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

function currentWorkspaceMeta(): WorkspaceMeta {
  const meta = readMeta() || { clientId: clientId(), localUpdatedAt: 0, serverUpdatedAt: 0, pending: false, revision: 0 };
  if (getWorkspaceMutationGeneration() !== acknowledgedMutationGeneration || hasWorkspaceDraftPending()) {
    if (!meta.pending) {
      const dirty = { ...meta, localUpdatedAt: Math.max(meta.localUpdatedAt, Date.now()), pending: true };
      writeMeta(dirty);
      return dirty;
    }
  }
  return meta;
}

function captureLocalState() {
  const persisted = localPersistedSignature();
  return { generation: getWorkspaceMutationGeneration(), meta: JSON.stringify(readMeta()), persisted };
}

function localPersistedSignature() {
  return JSON.stringify({ canvas: readCanvasWorkspace(), preferences: readPreferences() });
}

function localStateChanged(state: ReturnType<typeof captureLocalState>) {
  return hasWorkspaceDraftPending()
    || state.generation !== getWorkspaceMutationGeneration()
    || state.meta !== JSON.stringify(readMeta())
    || state.persisted !== localPersistedSignature();
}

function preserveLocalChanges(state: ReturnType<typeof captureLocalState>) {
  const meta = currentWorkspaceMeta();
  if (!meta.pending && state.persisted !== localPersistedSignature()) {
    writeMeta({ ...meta, localUpdatedAt: Math.max(meta.localUpdatedAt, Date.now()), pending: true });
  }
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

/**
 * Older LAN clients created this empty browser canvas before bootstrap and
 * marked it pending. It is an adapter placeholder, not user content, so it is
 * safe to replace it with the server snapshot when no sync baseline exists.
 * Browser preferences are intentionally excluded: a fresh client can have
 * theme/model settings before its first workspace request, but those settings
 * do not turn an empty canvas into user content.
 */
function isLegacyInitialCanvasPlaceholder(snapshot: WorkspaceSnapshot, meta: WorkspaceMeta) {
  if (!meta.pending || meta.revision !== 0 || meta.serverUpdatedAt !== 0 || meta.contentSignature) return false;
  if (snapshot.gallery.length || snapshot.chatSessions.length || snapshot.assetIndex.length) return false;
  if (snapshot.assetCollections.some((item) => !item.builtin)) return false;
  if (Object.keys(snapshot.canvas.ui).length || snapshot.canvas.projects.length !== 1) return false;
  const project = snapshot.canvas.projects[0];
  const document = snapshot.canvas.documents[project.id];
  return snapshot.canvas.activeId === project.id
    && Boolean(document)
    && document.nodes.length === 0
    && document.edges.length === 0
    && document.groups.length === 0;
}

type WorkspaceRow = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
};

function workspaceRowTimestamp(row: WorkspaceRow) {
  return Math.max(Number(row.updatedAt) || 0, Number(row.createdAt) || 0);
}

/** Merge independent workspace records without dropping data from either client. */
function mergeWorkspaceRows<T extends WorkspaceRow>(local: readonly T[], remote: readonly T[]) {
  const rows = new Map(remote.map((row) => [row.id, row] as const));
  for (const row of local) {
    const current = rows.get(row.id);
    if (!current || workspaceRowTimestamp(row) >= workspaceRowTimestamp(current)) rows.set(row.id, row);
  }
  return [...rows.values()].sort((left, right) => workspaceRowTimestamp(right) - workspaceRowTimestamp(left));
}

type WorkspaceCreativeProject = NonNullable<WorkspaceSnapshot['canvas']['creativeProjects']>[number];

function mergeCreativeProjects(local: readonly WorkspaceCreativeProject[], remote: readonly WorkspaceCreativeProject[]) {
  const projects = mergeWorkspaceRows(local, remote);
  return projects.map((project) => {
    const localProject = local.find((item) => item.id === project.id);
    const remoteProject = remote.find((item) => item.id === project.id);
    const versions = mergeWorkspaceRows(localProject?.versions || [], remoteProject?.versions || []);
    return versions.length ? { ...project, versions } : project;
  });
}

type WorkspaceCanvasDocument = WorkspaceSnapshot['canvas']['documents'][string];

function canvasDocumentHasData(document: WorkspaceCanvasDocument | undefined) {
  return Boolean(document && (document.nodes.length || document.edges.length || document.groups.length));
}

function mergeCanvasRows<T extends WorkspaceRow>(local: readonly T[], remote: readonly T[], localWins: boolean) {
  const rows = new Map(remote.map((row) => [row.id, row] as const));
  for (const row of local) {
    if (!rows.has(row.id) || localWins) rows.set(row.id, row);
  }
  return [...rows.values()];
}

function mergeCanvasDocuments(
  local: WorkspaceCanvasDocument | undefined,
  remote: WorkspaceCanvasDocument | undefined,
  localWins: boolean,
) {
  if (!local) return remote;
  if (!remote) return local;
  const base = localWins ? local : remote;
  return {
    ...base,
    nodes: mergeCanvasRows(local.nodes, remote.nodes, localWins),
    edges: mergeCanvasRows(local.edges, remote.edges, localWins),
    groups: mergeCanvasRows(local.groups, remote.groups, localWins),
  };
}

function selectMergedActiveProject(
  local: WorkspaceSnapshot,
  remote: WorkspaceSnapshot,
  projects: readonly WorkspaceSnapshot['canvas']['projects'][number][],
) {
  const projectIds = new Set(projects.map((project) => project.id));
  const localActive = local.canvas.activeId && projectIds.has(local.canvas.activeId) ? local.canvas.activeId : null;
  const remoteActive = remote.canvas.activeId && projectIds.has(remote.canvas.activeId) ? remote.canvas.activeId : null;
  if (localActive && canvasDocumentHasData(local.canvas.documents[localActive])) return localActive;
  if (remoteActive && canvasDocumentHasData(remote.canvas.documents[remoteActive])) return remoteActive;
  const candidates = [localActive, remoteActive].filter((id, index, values): id is string => Boolean(id) && values.indexOf(id) === index);
  candidates.sort((left, right) => {
    const leftProject = projects.find((project) => project.id === left);
    const rightProject = projects.find((project) => project.id === right);
    return workspaceRowTimestamp(rightProject || { id: right }) - workspaceRowTimestamp(leftProject || { id: left });
  });
  return candidates[0] || projects[0]?.id || null;
}

/**
 * Rebase a stale browser snapshot onto the current shared workspace. Canvas
 * projects are the conflict unit: newer project rows win, while unrelated
 * projects and history records are retained from both sides.
 */
export function mergeWorkspaceSnapshots(local: WorkspaceSnapshot, remote: WorkspaceSnapshot): WorkspaceSnapshot {
  const projects = mergeWorkspaceRows(local.canvas.projects, remote.canvas.projects);
  const documents = Object.fromEntries(projects.flatMap((project) => {
    const localProject = local.canvas.projects.find((item) => item.id === project.id);
    const remoteProject = remote.canvas.projects.find((item) => item.id === project.id);
    const localDocument = local.canvas.documents[project.id];
    const remoteDocument = remote.canvas.documents[project.id];
    const localWins = Boolean(localProject && (!remoteProject || workspaceRowTimestamp(localProject) >= workspaceRowTimestamp(remoteProject)));
    const document = mergeCanvasDocuments(localDocument, remoteDocument, localWins);
    return document ? [[project.id, document] as const] : [];
  }));
  const activeId = selectMergedActiveProject(local, remote, projects);
  return {
    schemaVersion: local.schemaVersion,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    clientId: local.clientId,
    canvas: {
      projects,
      activeId,
      documents,
      ui: { ...remote.canvas.ui, ...local.canvas.ui },
      creativeProjects: mergeCreativeProjects(local.canvas.creativeProjects || [], remote.canvas.creativeProjects || []),
    },
    gallery: mergeWorkspaceRows(local.gallery, remote.gallery),
    chatSessions: mergeWorkspaceRows(local.chatSessions, remote.chatSessions),
    assetIndex: mergeWorkspaceRows(local.assetIndex, remote.assetIndex),
    assetCollections: mergeWorkspaceRows(local.assetCollections, remote.assetCollections),
    preferences: { ...remote.preferences, ...local.preferences },
  };
}

export async function collectWorkspaceSnapshot(updatedAt = Date.now()): Promise<WorkspaceSnapshot> {
  const [gallery, chatSessions, assetIndex, assetCollections] = await Promise.all([
    assetRepository.listGallery(),
    listChatSessions(),
    assetRepository.listIndex(),
    assetRepository.listCollections(),
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
  // Metadata checks stay short; full snapshots can legitimately be large on
  // workspaces with image history and should not be treated as failed after
  // the old five-second UI timeout.
  const timeoutMs = method === 'PUT' ? 45_000 : 30_000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
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

async function requestWorkspaceMetadata() {
  const data = await requestWorkspaceMetadataInternal();
  return {
    updatedAt: Number(data.updatedAt || 0),
    revision: Number(data.revision || 0),
  };
}

async function requestWorkspaceMetadataInternal(): Promise<WorkspaceMetadataResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('/api/workspace?meta=1', {
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as WorkspaceMetadataResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || '读取工作区元数据失败');
    return data;
  } finally { window.clearTimeout(timeoutId); }
}

export async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  // Explicit backup restore is replacement, even if the old editor is dirty.
  // Invalidate any automatic GET/PUT still awaiting a response.
  explicitRestoreGeneration += 1;
  emitWorkspaceMutation();
  await restoreWorkspaceSnapshotInternal(snapshot, readMeta()?.revision ?? 0);
}

async function restoreWorkspaceSnapshotInternal(
  snapshot: WorkspaceSnapshot,
  revision = 0,
  contentHash?: string,
  automaticState?: ReturnType<typeof captureLocalState>,
  stopped = () => false,
) {
  const generation = getWorkspaceMutationGeneration();
  const restoreGeneration = explicitRestoreGeneration;
  const restoreCanvas = () => withWorkspaceRestoreSuppressed(() => {
    if (!restoreCanvasWorkspace(snapshot.canvas)) throw new Error('恢复画布失败');
  });
  return withWorkspaceRestoreSuppressedAsync(async () => {
    // Explicit backup replacement keeps its existing semantics. Automatic sync
    // must leave the editor's optimistic-save baseline untouched during I/O.
    if (!automaticState) restoreCanvas();
    const canWrite = automaticState ? () => !localStateChanged(automaticState) && !stopped()
      && restoreGeneration === explicitRestoreGeneration && (readMeta()?.revision ?? 0) <= revision : undefined;
    await assetRepository.replaceGallery(snapshot.gallery, canWrite);
    await replaceChatSessions(snapshot.chatSessions, canWrite);
    await assetRepository.replaceIndex(snapshot.assetIndex, canWrite);
    await assetRepository.saveCollections(snapshot.assetCollections, canWrite);
    if (automaticState && (localStateChanged(automaticState) || stopped())) {
      preserveLocalChanges(automaticState);
      return false;
    }
    const current = readMeta();
    const changed = generation !== getWorkspaceMutationGeneration() || hasWorkspaceDraftPending();
    if (restoreGeneration !== explicitRestoreGeneration || (current?.revision ?? 0) > revision) {
      if (changed && current) writeMeta({ ...current, pending: true });
      return false;
    }
    // No await between this guard, canvas replacement and baseline metadata.
    if (automaticState) restoreCanvas();
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
      localUpdatedAt: changed ? Math.max(current?.localUpdatedAt || 0, Date.now()) : snapshot.updatedAt,
      serverUpdatedAt: snapshot.updatedAt,
      revision,
      contentHash,
      pending: changed,
      contentSignature: workspaceContentSignature(snapshot),
    });
    acknowledgedMutationGeneration = generation;
    return !changed;
  });
}

async function saveWorkspace(snapshot: WorkspaceSnapshot, meta: WorkspaceMeta, generation: number, keepalive = false) {
  const restoreGeneration = explicitRestoreGeneration;
  writeMeta({ ...meta, localUpdatedAt: snapshot.updatedAt, pending: true });
  const data = await requestWorkspace('PUT', snapshot, keepalive, meta.revision ?? 0);
  const serverUpdatedAt = Number(data.updatedAt || snapshot.updatedAt);
  const revision = Number(data.revision ?? (meta.revision ?? 0) + 1);
  const current = readMeta() || meta;
  // A backup restore or another tab may have advanced the baseline meanwhile.
  // Never roll that baseline back to this PUT's response.
  if (restoreGeneration !== explicitRestoreGeneration || (current.revision ?? 0) > revision) return false;
  const pending = generation !== getWorkspaceMutationGeneration()
    || hasWorkspaceDraftPending()
    || current.localUpdatedAt !== snapshot.updatedAt;
  writeMeta({
    ...current,
    clientId: snapshot.clientId,
    serverUpdatedAt,
    revision,
    contentHash: data.contentHash || undefined,
    pending,
    contentSignature: workspaceContentSignature(snapshot),
  });
  acknowledgedMutationGeneration = generation;
  return !pending;
}

async function rebaseWorkspaceAfterConflict(
  local: WorkspaceSnapshot,
  state: ReturnType<typeof captureLocalState>,
  keepalive: boolean,
) {
  const server = await requestWorkspace('GET');
  const remote = server.workspace ? validateWorkspaceShape(server.workspace) as unknown as WorkspaceSnapshot : null;
  const revision = Number(server.revision ?? 0);
  if (!remote || revision < (readMeta()?.revision ?? 0)) {
    throw new WorkspaceConflictError('工作区版本变化过快，请刷新后再保存');
  }
  if (localStateChanged(state)) {
    preserveLocalChanges(state);
    return { synced: false, rebased: false };
  }
  const merged = mergeWorkspaceSnapshots(local, remote);
  const restored = await restoreWorkspaceSnapshotInternal(
    merged,
    revision,
    server.contentHash || undefined,
    state,
  );
  if (!restored) return { synced: false, rebased: false };
  const baseline = readMeta() || currentWorkspaceMeta();
  const synced = await saveWorkspace(merged, {
    ...baseline,
    revision,
    serverUpdatedAt: Number(server.updatedAt || remote.updatedAt),
    pending: true,
  }, state.generation, keepalive);
  return { synced, rebased: true };
}

async function uploadLocalWorkspace(keepalive = false, onRestored?: () => void) {
  const meta = currentWorkspaceMeta();
  if (hasWorkspaceDraftPending()) return false;
  const state = captureLocalState();
  const local = await collectWorkspaceSnapshot(Math.max(meta.localUpdatedAt, Date.now()));
  if (localStateChanged(state)) { preserveLocalChanges(state); return false; }
  try {
    return await saveWorkspace(local, meta, state.generation, keepalive);
  } catch (error) {
    if (!(error instanceof WorkspaceConflictError)) throw error;
    // saveWorkspace marks the in-flight snapshot pending before PUT. Capture
    // that bookkeeping baseline, then let the rebase guard detect real edits
    // made while the conflict GET and restore are in progress.
    const conflictState = captureLocalState();
    const result = await rebaseWorkspaceAfterConflict(local, conflictState, keepalive);
    if (result.rebased) onRestored?.();
    return result.synced;
  }
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
  try {
    await reconcileWorkspace();
    return { offline: false };
  } catch {
    const local = await collectWorkspaceSnapshot().catch(() => null);
    const currentMeta = currentWorkspaceMeta();
    writeMeta({
      ...currentMeta,
      clientId: local?.clientId || currentMeta.clientId,
      pending: currentMeta.pending || Boolean(local && workspaceHasData(local)),
    });
    return { offline: true };
  }
}

/** Automatic sync only replaces a stable, persisted local baseline. */
async function reconcileWorkspace(onRestored?: () => void, stopped = () => false) {
  const meta = currentWorkspaceMeta();
  if (hasWorkspaceDraftPending() || stopped()) return false;
  const state = captureLocalState();
  const metadata = await requestWorkspaceMetadata();
  if (localStateChanged(state) || stopped()) { preserveLocalChanges(state); return false; }

  const local = await collectWorkspaceSnapshot();
  if (localStateChanged(state) || stopped()) { preserveLocalChanges(state); return false; }
  // A pending snapshot belongs to the revision it was edited against. Reading
  // a fresh remote revision must never turn a CAS conflict into an overwrite.
  // The one exception is the pre-bootstrap placeholder written by older LAN
  // clients; it has no baseline or user data and must be replaced by GET.
  if (meta.pending && !isLegacyInitialCanvasPlaceholder(local, meta)) return uploadLocalWorkspace(false, onRestored);
  if (meta.contentSignature && meta.contentSignature !== workspaceContentSignature(local)) {
    writeMeta({ ...meta, localUpdatedAt: Date.now(), pending: true });
    return uploadLocalWorkspace(false, onRestored);
  }
  // Collect even on metadata-only polls: preferences or another tab can change
  // the persisted cache without delivering this tab's workspace event.
  if (meta.contentSignature && meta.serverUpdatedAt === metadata.updatedAt && (meta.revision ?? 0) === metadata.revision) return true;

  const server = await requestWorkspace('GET');
  if (localStateChanged(state) || stopped()) {
    preserveLocalChanges(state);
    return false;
  }
  const remote = server.workspace ? validateWorkspaceShape(server.workspace) as unknown as WorkspaceSnapshot : null;
  const revision = Number(server.revision ?? 0);
  if (revision < metadata.revision || revision < (meta.revision ?? 0)) return false;
  if (remote) {
    const restored = await restoreWorkspaceSnapshotInternal(remote, revision, server.contentHash || undefined, state, stopped);
    // Core edits during asynchronous history restore stay in the editor. Do
    // not reload its document over those edits via the UI restore callback.
    if (restored && !stopped() && !hasWorkspaceDraftPending() && state.generation === getWorkspaceMutationGeneration()) onRestored?.();
    return restored && !currentWorkspaceMeta().pending;
  }
  if (workspaceHasData(local)) return uploadLocalWorkspace(false, onRestored);
  writeMeta({ ...meta, revision, pending: false });
  acknowledgedMutationGeneration = state.generation;
  return true;
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
    let completed = false;
    setStatus('syncing');
    try {
      if (bootstrapPromise) await bootstrapPromise;
      if (stopped) return;
      const synced = await reconcileWorkspace(options.onRestored, () => stopped);
      completed = true;
      setStatus(synced ? 'synced' : 'idle');
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        setStatus('conflict');
        return;
      }
      setStatus('offline');
      retryTimer = window.setTimeout(() => void reconcile(), SYNC_INTERVAL_MS);
    } finally {
      syncing = false;
      if (completed) schedulePendingPush();
    }
  };

  const push = async (keepalive = false) => {
    if (stopped || syncing || bootstrapPromise || hasWorkspaceDraftPending()) return;
    const before = currentWorkspaceMeta();
    if (!before.pending) return;
    syncing = true;
    let completed = false;
    setStatus('syncing');
    try {
      const synced = await uploadLocalWorkspace(keepalive);
      completed = true;
      setStatus(synced ? 'synced' : 'idle');
    } catch (error) {
      const current = readMeta();
      if (current) writeMeta({ ...current, pending: true });
      setStatus(error instanceof WorkspaceConflictError ? 'conflict' : 'error');
    } finally {
      syncing = false;
      if (completed) schedulePendingPush();
    }
  };

  const schedulePendingPush = () => {
    if (!stopped && readMeta()?.pending && !hasWorkspaceDraftPending() && getWorkspaceMutationGeneration() !== acknowledgedMutationGeneration) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void push(), SYNC_DEBOUNCE_MS);
    }
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

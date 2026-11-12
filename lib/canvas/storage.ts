import type { CanvasDocument, CanvasProject } from './types';
import { CANVAS_VERSION, normalizeDocument } from './model';
import { canvasInlineImageUrls } from './inline-images';
import { emitWorkspaceChange, withWorkspaceRestoreSuppressed } from '../workspace-events';
import type { CanvasWorkspaceData } from '../workspace-types';
import {
  listCanvasStorageEntries,
  getCanvasStorageSourceId,
  publishCanvasStorageChange,
  transactCanvasStorage,
  type CanvasStorageMutation,
} from '../client-history';
import {
  CREATIVE_PROJECTS_KEY,
  CREATIVE_PROJECTS_STORAGE_KEY,
  hydrateCreativeProjects,
  normalizeCreativeProjects,
  pruneOldestAutomaticCreativeProjectVersion,
  readCreativeProjects,
  reconcileCreativeProjects,
} from '../creative-projects';
import { compressSync, decompressSync, strFromU8, strToU8 } from 'fflate';

export const CANVAS_PROJECTS_KEY = 'sanmao.canvas.projects';
export const CANVAS_ACTIVE_KEY = 'sanmao.canvas.active';
export const CANVAS_UI_KEY = 'sanmao.canvas.ui';
export const CANVAS_DELETION_TOMBSTONES_KEY = 'sanmao.canvas.deletion-tombstones.v1';
const CANVAS_TAB_ACTIVE_KEY = 'sanmao.canvas.tab-active';
const NOVA_PROJECTS_KEY = 'nova.v1.projects';
const NOVA_ACTIVE_KEY = 'nova.v1.active';
const NOVA_PROJECT_PREFIX = 'nova.v1.project.';
const MIGRATION_KEY = 'sanmao.canvas.nova-migrated';
const MIGRATION_BACKUP_KEY = 'sanmao.canvas.nova-backup';
export const CANVAS_V1_BACKUP_PREFIX = 'sanmao.canvas.v1-backup.';
export const CANVAS_STORAGE_CHANGE_EVENT = 'sanmao-canvas-storage-change';

const DB_PROJECTS_KEY = 'canvas:projects';
const DB_ACTIVE_KEY = 'canvas:active';
const DB_UI_KEY = 'canvas:ui';
const DB_TOMBSTONES_KEY = 'canvas:deletion-tombstones';
const DB_DOCUMENT_PREFIX = 'canvas:document:';
const DB_V1_BACKUP_PREFIX = 'canvas:v1-backup:';
const DB_NOVA_MIGRATION_KEY = 'canvas:nova-migration';
const DB_NOVA_BACKUP_KEY = 'canvas:nova-backup';

type CanvasStorageCache = {
  projects: CanvasProject[];
  activeId: string | null;
  ui: Record<string, unknown>;
  tombstones: CanvasDeletionTombstones;
  documents: Record<string, CanvasDocument>;
  initialized: boolean;
};

let canvasCache: CanvasStorageCache = {
  projects: [], activeId: null, ui: {}, tombstones: {}, documents: {}, initialized: false,
};
let ensureStoragePromise: Promise<{ projects: CanvasProject[]; activeId: string; migrated: boolean }> | null = null;
const cachedRecordKeys = new Set<string>();
let canvasChannel: BroadcastChannel | null = null;

const LOCAL_JSON_COMPRESSION_PREFIX = 'sanmao:deflate:v1:';

function encodeLocalJson(value: unknown) {
  const raw = JSON.stringify(value);
  try {
    const compressed = compressSync(strToU8(raw), { level: 6 });
    let binary = '';
    for (let offset = 0; offset < compressed.length; offset += 0x8000) {
      binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
    }
    const encoded = `${LOCAL_JSON_COMPRESSION_PREFIX}${btoa(binary)}`;
    return encoded.length < raw.length ? encoded : raw;
  } catch {
    return raw;
  }
}

function parseLocalJson<T>(raw: string, fallback: T): T {
  try {
    if (!raw.startsWith(LOCAL_JSON_COMPRESSION_PREFIX)) return JSON.parse(raw) as T;
    const binary = atob(raw.slice(LOCAL_JSON_COMPRESSION_PREFIX.length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return JSON.parse(strFromU8(decompressSync(bytes))) as T;
  } catch {
    return fallback;
  }
}

export type CanvasDeletionTombstone = {
  nodes: string[];
  edges: string[];
  groups: string[];
};

export type CanvasDeletionTombstones = Record<string, CanvasDeletionTombstone>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? parseLocalJson(value, fallback) : fallback;
  } catch { return fallback; }
}

let storageQuotaExceeded = false;
let storageConflict = false;
let storageInlineImagesPending = false;
let storagePrunedAutomaticCheckpoints = 0;

export function takeCanvasStorageAutomaticCheckpointCleanupCount() {
  const count = storagePrunedAutomaticCheckpoints;
  storagePrunedAutomaticCheckpoints = 0;
  return count;
}

function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function writeJson(key: string, value: unknown) {
  storageInlineImagesPending = false;
  try {
    window.localStorage.setItem(key, encodeLocalJson(value));
    storageQuotaExceeded = false;
    return true;
  } catch (error) {
    storageQuotaExceeded = isQuotaExceededError(error);
    return false;
  }
}

function dbKeyForLocalKey(key: string) {
  if (key === CANVAS_PROJECTS_KEY) return DB_PROJECTS_KEY;
  if (key === CANVAS_ACTIVE_KEY) return DB_ACTIVE_KEY;
  if (key === CANVAS_UI_KEY) return DB_UI_KEY;
  if (key === CANVAS_DELETION_TOMBSTONES_KEY) return DB_TOMBSTONES_KEY;
  if (key === CREATIVE_PROJECTS_KEY) return CREATIVE_PROJECTS_STORAGE_KEY;
  if (key.startsWith(CANVAS_PROJECT_PREFIX)) return `${DB_DOCUMENT_PREFIX}${key.slice(CANVAS_PROJECT_PREFIX.length)}`;
  if (key.startsWith(CANVAS_V1_BACKUP_PREFIX)) return `${DB_V1_BACKUP_PREFIX}${key.slice(CANVAS_V1_BACKUP_PREFIX.length)}`;
  return null;
}

function cacheValueForDbKey(key: string) {
  if (key === DB_PROJECTS_KEY) return canvasCache.projects;
  if (key === DB_ACTIVE_KEY) return canvasCache.activeId;
  if (key === DB_UI_KEY) return canvasCache.ui;
  if (key === DB_TOMBSTONES_KEY) return canvasCache.tombstones;
  if (key === CREATIVE_PROJECTS_STORAGE_KEY) return readCreativeProjects();
  if (key.startsWith(DB_DOCUMENT_PREFIX)) return canvasCache.documents[key.slice(DB_DOCUMENT_PREFIX.length)];
  return undefined;
}

function cacheHasDbKey(key: string) {
  return cachedRecordKeys.has(key);
}

function sameValue(left: unknown, right: unknown) {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function applyDbRecord(key: string, value: unknown) {
  if (key === DB_PROJECTS_KEY) canvasCache.projects = normalizeProjects(value);
  else if (key === DB_ACTIVE_KEY) canvasCache.activeId = typeof value === 'string' ? value : null;
  else if (key === DB_UI_KEY) canvasCache.ui = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  else if (key === DB_TOMBSTONES_KEY) canvasCache.tombstones = normalizeDeletionTombstones(value);
  else if (key === CREATIVE_PROJECTS_STORAGE_KEY) hydrateCreativeProjects(value);
  else if (key.startsWith(DB_DOCUMENT_PREFIX)) {
    canvasCache.documents[key.slice(DB_DOCUMENT_PREFIX.length)] = normalizeDocument(value);
  } else if (key.startsWith(DB_V1_BACKUP_PREFIX)) {
    return;
  }
  cachedRecordKeys.add(key);
}

function removeDbRecord(key: string) {
  cachedRecordKeys.delete(key);
  if (key.startsWith(DB_DOCUMENT_PREFIX)) delete canvasCache.documents[key.slice(DB_DOCUMENT_PREFIX.length)];
  else if (key === CREATIVE_PROJECTS_STORAGE_KEY) hydrateCreativeProjects([]);
  else if (key === DB_PROJECTS_KEY) canvasCache.projects = [];
  else if (key === DB_ACTIVE_KEY) canvasCache.activeId = null;
  else if (key === DB_UI_KEY) canvasCache.ui = {};
  else if (key === DB_TOMBSTONES_KEY) canvasCache.tombstones = {};
}

function hydrateCanvasCache(entries: readonly { key: string; value: unknown }[]) {
  canvasCache = { projects: [], activeId: null, ui: {}, tombstones: {}, documents: {}, initialized: true };
  cachedRecordKeys.clear();
  for (const entry of entries) applyDbRecord(entry.key, entry.value);
  if (!cachedRecordKeys.has(CREATIVE_PROJECTS_STORAGE_KEY)) hydrateCreativeProjects([]);
  canvasCache.initialized = true;
}

function notifyCanvasStorageChanged(dispatchLocalEvent = false) {
  if (typeof window !== 'undefined') {
    if (dispatchLocalEvent) window.dispatchEvent(new Event(CANVAS_STORAGE_CHANGE_EVENT));
    emitWorkspaceChange();
  }
}

async function refreshCanvasCacheFromDatabase() {
  const entries = await listCanvasStorageEntries();
  hydrateCanvasCache(entries);
  notifyCanvasStorageChanged(true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    canvasChannel = new BroadcastChannel('sanmao.canvas.storage.v1');
    const sourceId = getCanvasStorageSourceId();
    canvasChannel.onmessage = (event) => {
      if (event.data?.source === sourceId) return;
      void refreshCanvasCacheFromDatabase().catch(() => {});
    };
  } catch { canvasChannel = null; }
}

type CanvasEntryWriteResult = { saved: boolean; guarded?: boolean; changed?: boolean; current: [string, unknown][] };

async function writeCanvasEntries(entries: ReadonlyMap<string, string | null>, guard?: () => boolean, emitWorkspace = true) {
  const writes: Array<{ key: string; mutation: CanvasStorageMutation }> = [];
  for (const [localKey, raw] of entries) {
    const key = dbKeyForLocalKey(localKey);
    if (!key) continue;
    if (raw === null) writes.push({ key, mutation: { type: 'delete', key } });
    else {
      let value: unknown;
      try { value = JSON.parse(raw); }
      catch { return false; }
      writes.push({ key, mutation: { type: 'put', key, value } });
    }
  }
  if (!writes.length) return true;
  const keys = [...new Set(writes.map((item) => item.key))];
  const expected = new Map(keys.map((key) => [key, { present: cacheHasDbKey(key), value: cacheValueForDbKey(key) }] as const));
  try {
    const result = await transactCanvasStorage<CanvasEntryWriteResult>(keys, (current) => {
      const snapshot = [...current.entries()];
      if (guard && !guard()) return { result: { saved: false, guarded: true, current: snapshot }, mutations: [] };
      for (const [key, expectedValue] of expected) {
        if (current.has(key) !== expectedValue.present || (expectedValue.present && !sameValue(current.get(key), expectedValue.value))) {
          return { result: { saved: false, current: snapshot }, mutations: [] };
        }
      }
      const mutations = writes.filter(({ mutation }) => {
        if (mutation.type === 'delete') return current.has(mutation.key);
        return !current.has(mutation.key) || !sameValue(current.get(mutation.key), mutation.value);
      }).map((item) => item.mutation);
      return { result: { saved: true, changed: mutations.length > 0, current: snapshot }, mutations };
    });
    if (!result.saved) {
      for (const [key, value] of result.current) applyDbRecord(key, value);
      for (const key of keys) if (!result.current.some(([currentKey]) => currentKey === key)) removeDbRecord(key);
      if (!result.guarded) storageConflict = true;
      return false;
    }
    for (const { mutation } of writes) {
      if (mutation.type === 'delete') removeDbRecord(mutation.key);
      else applyDbRecord(mutation.key, mutation.value);
    }
    storageQuotaExceeded = false;
    storageConflict = false;
    if (result.changed) {
      if (emitWorkspace) notifyCanvasStorageChanged();
      publishCanvasStorageChange();
    }
    return true;
  } catch (error) {
    storageQuotaExceeded = isQuotaExceededError(error);
    return false;
  }
}

/** 最近一次画布写入失败的提示：区分浏览器存储配额不足与其它写入失败。 */
export function describeCanvasSaveFailure() {
  if (storageConflict) return '这个画布已在其他页面更新或删除，当前内容已保留，请先导出工作流 JSON，再重新打开画布。';
  if (storageInlineImagesPending) return '画布中还有内嵌图片未能归档，已暂停本地保存以避免占满浏览器存储。请修复图片存储后编辑画布重试，或先导出工作流 JSON。';
  return storageQuotaExceeded
    ? '浏览器数据空间不足：画布和项目版本仍保留在本地，请清理浏览器站点数据空间后重试，或先导出工作流 JSON。'
    : '画布保存失败，请先导出工作流 JSON。';
}

function normalizeProjects(value: unknown): CanvasProject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).map((item, index) => ({
    id: String(item.id || `canvas_${index + 1}`),
    ...(item.projectId ? { projectId: String(item.projectId).trim().slice(0, 300) } : {}),
    name: String(item.name || `新画布 ${index + 1}`),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
  }));
}

function normalizeDeletionTombstones(value: unknown): CanvasDeletionTombstones {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: CanvasDeletionTombstones = {};
  for (const [projectId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const ids = (key: keyof CanvasDeletionTombstone) => Array.from(new Set(
      (Array.isArray(record[key]) ? record[key] : [])
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim().slice(0, 200)),
    ));
    const tombstone = { nodes: ids('nodes'), edges: ids('edges'), groups: ids('groups') };
    if (tombstone.nodes.length || tombstone.edges.length || tombstone.groups.length) result[projectId] = tombstone;
  }
  return result;
}

function idsOf(rows: ReadonlyArray<{ id: string }>) {
  return new Set(rows.map((row) => row.id));
}

function updateDeletionTombstones(
  current: CanvasDeletionTombstones,
  projectId: string,
  previous: CanvasDocument,
  next: CanvasDocument,
) {
  const result = normalizeDeletionTombstones(current);
  const previousRows = { nodes: previous.nodes, edges: previous.edges, groups: previous.groups };
  const nextRows = { nodes: next.nodes, edges: next.edges, groups: next.groups };
  const tombstone = result[projectId] || { nodes: [], edges: [], groups: [] };
  (['nodes', 'edges', 'groups'] as const).forEach((key) => {
    const removed = idsOf(previousRows[key]);
    const present = idsOf(nextRows[key]);
    for (const id of present) removed.delete(id);
    const ids = new Set(tombstone[key]);
    for (const id of removed) ids.add(id);
    for (const id of present) ids.delete(id);
    tombstone[key] = [...ids];
  });
  if (tombstone.nodes.length || tombstone.edges.length || tombstone.groups.length) result[projectId] = tombstone;
  else delete result[projectId];
  return result;
}

function activeProjectId(projects: CanvasProject[], value: unknown) {
  const activeId = typeof value === 'string' ? value : '';
  return projects.some((project) => project.id === activeId) ? activeId : projects[0]?.id || null;
}

function cleanupBackedUpNovaSources(entries: readonly { key: string; value: unknown }[] = []) {
  try {
    const databaseMigration = entries.find((entry) => entry.key === DB_NOVA_MIGRATION_KEY)?.value;
    const databaseBackup = entries.find((entry) => entry.key === DB_NOVA_BACKUP_KEY)?.value;
    const migration = databaseMigration && typeof databaseMigration === 'object'
      ? databaseMigration as Record<string, unknown>
      : readJson<Record<string, unknown> | null>(MIGRATION_KEY, null);
    const backup = databaseMigration && typeof databaseMigration === 'object'
      && (databaseMigration as Record<string, unknown>).backupKey === DB_NOVA_BACKUP_KEY
      ? databaseBackup as Record<string, unknown> | null
      : readJson<Record<string, unknown> | null>(MIGRATION_BACKUP_KEY, null);
    if (migration?.source !== 'nova.v1' || migration.backupKey !== MIGRATION_BACKUP_KEY
      && migration.backupKey !== DB_NOVA_BACKUP_KEY
      || backup?.source !== 'nova.v1' || typeof backup.backedUpAt !== 'string'
      || !Array.isArray(backup.projects) || !backup.documents || typeof backup.documents !== 'object'
      || Array.isArray(backup.documents)) return;

    const projects = normalizeProjects(backup.projects);
    const sourceProjects = readJson<unknown>(NOVA_PROJECTS_KEY, null);
    if (!projects.length || projects.length !== backup.projects.length || !Array.isArray(sourceProjects)
      || JSON.stringify(normalizeProjects(sourceProjects)) !== JSON.stringify(projects)
      || readJson<unknown>(NOVA_ACTIVE_KEY, null) !== backup.activeId) return;

    const documents = backup.documents as Record<string, unknown>;
    const projectIds = new Set(projects.map((project) => project.id));
    if (Object.keys(documents).some((id) => !projectIds.has(id))) return;

    const sourceDocumentKeys: string[] = [];
    for (const project of projects) {
      const sourceKey = `${NOVA_PROJECT_PREFIX}${project.id}`;
      const sourceRaw = window.localStorage.getItem(sourceKey);
      if (sourceRaw === null) continue;
      const sourceDocument = readJson<unknown>(sourceKey, null);
      if (!Object.prototype.hasOwnProperty.call(documents, project.id)
        || JSON.stringify(normalizeDocument(sourceDocument)) !== JSON.stringify(normalizeDocument(documents[project.id]))) return;
      sourceDocumentKeys.push(sourceKey);
    }

    [NOVA_PROJECTS_KEY, NOVA_ACTIVE_KEY, ...sourceDocumentKeys]
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // The complete migration backup remains available if legacy cleanup fails.
  }
}

function compactRetainedNovaBackup() {
  try {
    const raw = window.localStorage.getItem(MIGRATION_BACKUP_KEY);
    if (!raw || raw.startsWith(LOCAL_JSON_COMPRESSION_PREFIX)) return;
    const backup = parseLocalJson<unknown>(raw, undefined);
    if (backup === undefined) return;
    const compact = encodeLocalJson(backup);
    if (compact.length >= raw.length) return;
    try { window.localStorage.setItem(MIGRATION_BACKUP_KEY, compact); } catch { /* Keep the verified uncompressed rollback snapshot. */ }
  } catch { /* The rollback snapshot remains usable in its original encoding. */ }
}

/** Current selection belongs to this tab; the snapshot activeId is only a startup default. */
export function retainedCanvasProjectId(projects: CanvasProject[], currentId: string | null, defaultId: string | null) {
  return activeProjectId(projects, currentId && projects.some((project) => project.id === currentId) ? currentId : defaultId);
}

export function readCanvasProjects() {
  return normalizeProjects(canvasCache.initialized ? canvasCache.projects : readJson(CANVAS_PROJECTS_KEY, []));
}

function tabActiveProjectId(projects: CanvasProject[]) {
  let selected: string | null = null;
  try { selected = window.sessionStorage.getItem(CANVAS_TAB_ACTIVE_KEY); } catch {}
  const activeId = retainedCanvasProjectId(projects, selected, readJson(CANVAS_ACTIVE_KEY, null));
  // Capture the startup default in this tab too, so reloading it cannot adopt
  // a different tab's most recently opened canvas.
  if (activeId) { try { window.sessionStorage.setItem(CANVAS_TAB_ACTIVE_KEY, activeId); } catch {} }
  return activeId;
}

export function saveCanvasActiveProject(id: string) {
  if (!readCanvasProjects().some((project) => project.id === id)) return false;
  try { window.sessionStorage.setItem(CANVAS_TAB_ACTIVE_KEY, id); } catch {}
  return writeCanvasEntries(new Map([[CANVAS_ACTIVE_KEY, JSON.stringify(id)]]));
}

async function persistProjectIdentity(projects: CanvasProject[], storedProjects = readCreativeProjects(), entries = new Map<string, string | null>()) {
  const preferredProjectId = projects.length === 1 && typeof window !== 'undefined'
    ? (() => {
        try {
          const raw = parseLocalJson<Record<string, unknown> | null>(window.localStorage.getItem('sanmao.workspace.context.v1') || 'null', null);
          return typeof raw?.creativeProjectId === 'string' && raw.creativeProjectId.trim() ? raw.creativeProjectId.trim() : undefined;
        } catch { return undefined; }
      })()
    : undefined;
  const preparedProjects = preferredProjectId && !projects[0]?.projectId
    ? [{ ...projects[0], projectId: preferredProjectId }, ...projects.slice(1)]
    : projects;
  const identity = reconcileCreativeProjects(preparedProjects, storedProjects);
  entries.set(CANVAS_PROJECTS_KEY, JSON.stringify(identity.canvasProjects));
  entries.set(CREATIVE_PROJECTS_KEY, JSON.stringify(normalizeCreativeProjects(identity.creativeProjects)));
  const saved = await writeCanvasEntries(entries);
  return { ...identity, saved };
}

/** Reads the current canvas without creating a project during workspace bootstrap. */
export function readCanvasWorkspace(): CanvasWorkspaceData {
  const projects = canvasCache.initialized ? canvasCache.projects : normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  const identity = reconcileCreativeProjects(projects, readCreativeProjects());
  const documents = canvasCache.initialized
    ? Object.fromEntries(projects.flatMap((project) => canvasCache.documents[project.id] ? [[project.id, normalizeDocument(canvasCache.documents[project.id])]] : []))
    : projects.reduce<Record<string, CanvasDocument>>((result, project) => {
        const value = readJson<unknown>(`${CANVAS_PROJECT_PREFIX}${project.id}`, null);
        if (value) result[project.id] = normalizeDocument(value);
        return result;
      }, {});
  return {
    projects: identity.canvasProjects,
    activeId: activeProjectId(projects, canvasCache.initialized ? canvasCache.activeId : readJson(CANVAS_ACTIVE_KEY, null)),
    documents,
    ui: canvasCache.initialized ? { ...canvasCache.ui } : readJson<Record<string, unknown>>(CANVAS_UI_KEY, {}),
    creativeProjects: identity.creativeProjects,
  };
}

export async function restoreCanvasWorkspace(value: Partial<CanvasWorkspaceData> | null | undefined, canWrite?: () => boolean) {
  const identity = reconcileCreativeProjects(normalizeProjects(value?.projects), normalizeCreativeProjects(value?.creativeProjects));
  const projects = identity.canvasProjects;
  const activeId = activeProjectId(projects, value?.activeId);
  try {
    const entries = new Map<string, string | null>();
    for (const id of Object.keys(canvasCache.documents)) {
      if (!projects.some((project) => project.id === id)) entries.set(`${CANVAS_PROJECT_PREFIX}${id}`, null);
    }
    projects.forEach((project) => entries.set(
      `${CANVAS_PROJECT_PREFIX}${project.id}`,
      JSON.stringify(normalizeDocument(value?.documents?.[project.id] || null)),
    ));
    entries.set(CANVAS_PROJECTS_KEY, JSON.stringify(projects));
    entries.set(CANVAS_ACTIVE_KEY, JSON.stringify(activeId));
    entries.set(CANVAS_UI_KEY, JSON.stringify(value?.ui && typeof value.ui === 'object' ? value.ui : {}));
    entries.set(CREATIVE_PROJECTS_KEY, JSON.stringify(normalizeCreativeProjects(identity.creativeProjects)));
    return await writeCanvasEntries(entries, canWrite);
  } catch {
    storageQuotaExceeded = true;
    return false;
  }
}

function legacyState() {
  let projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  let migrated = false;
  let legacySource: { projects: CanvasProject[]; activeId: string | null; documents: Record<string, CanvasDocument> } | null = null;
  if (!projects.length) {
    const novaProjects = normalizeProjects(readJson(NOVA_PROJECTS_KEY, []));
    if (novaProjects.length) {
      migrated = true;
      const activeId = readJson<string | null>(NOVA_ACTIVE_KEY, null);
      const legacyDocuments = novaProjects.reduce<Record<string, CanvasDocument>>((result, project) => {
        const value = readJson<unknown>(`${NOVA_PROJECT_PREFIX}${project.id}`, null);
        if (value) result[project.id] = normalizeDocument(value);
        return result;
      }, {});
      legacySource = { projects: novaProjects, activeId, documents: legacyDocuments };
      projects = novaProjects;
    }
  }
  const legacyDocuments = projects.reduce<Record<string, CanvasDocument>>((result, project) => {
    const value = legacySource?.documents[project.id] || readJson<unknown>(`${CANVAS_PROJECT_PREFIX}${project.id}`, null);
    if (value) result[project.id] = normalizeDocument(value);
    return result;
  }, {});
  const activeId = legacySource?.activeId && projects.some((project) => project.id === legacySource?.activeId)
    ? legacySource.activeId
    : readJson<string | null>(CANVAS_ACTIVE_KEY, null);
  return {
    projects,
    activeId: activeProjectId(projects, activeId),
    documents: legacyDocuments,
    ui: readJson<Record<string, unknown>>(CANVAS_UI_KEY, {}),
    tombstones: normalizeDeletionTombstones(readJson(CANVAS_DELETION_TOMBSTONES_KEY, {})),
    creativeProjects: normalizeCreativeProjects(readCreativeProjects()),
    migrated,
    legacySource,
    novaBackup: legacySource ? { backedUpAt: new Date().toISOString(), source: 'nova.v1', ...legacySource } : null,
  };
}

function dbEntriesFromState(state: ReturnType<typeof legacyState>) {
  const identity = reconcileCreativeProjects(state.projects, state.creativeProjects);
  const entries = new Map<string, unknown>([
    [DB_PROJECTS_KEY, identity.canvasProjects],
    [DB_ACTIVE_KEY, activeProjectId(identity.canvasProjects, state.activeId)],
    [DB_UI_KEY, state.ui],
    [DB_TOMBSTONES_KEY, state.tombstones],
    [CREATIVE_PROJECTS_STORAGE_KEY, normalizeCreativeProjects(identity.creativeProjects)],
  ]);
  for (const project of identity.canvasProjects) {
    entries.set(`${DB_DOCUMENT_PREFIX}${project.id}`, normalizeDocument(state.documents[project.id] || null));
  }
  if (state.novaBackup) {
    entries.set(DB_NOVA_BACKUP_KEY, state.novaBackup);
    entries.set(DB_NOVA_MIGRATION_KEY, { source: 'nova.v1', migratedAt: Date.now(), backupKey: DB_NOVA_BACKUP_KEY });
  }
  return entries;
}

function retainNovaBackupInLocalStorage(backup: unknown) {
  if (!backup) return;
  try {
    if (window.localStorage.getItem(MIGRATION_BACKUP_KEY) === null) writeJson(MIGRATION_BACKUP_KEY, backup);
  } catch {
    // IndexedDB already holds the authoritative rollback snapshot.
  }
}

function legacyRecordsMatchDatabase(entries: readonly { key: string; value: unknown }[]) {
  const values = new Map(entries.map((entry) => [entry.key, entry.value] as const));
  const legacyKeys = Object.keys(window.localStorage).filter((key) =>
    key === CANVAS_PROJECTS_KEY || key === CANVAS_ACTIVE_KEY || key === CANVAS_UI_KEY
      || key === CANVAS_DELETION_TOMBSTONES_KEY || key === CREATIVE_PROJECTS_KEY
      || key.startsWith(CANVAS_PROJECT_PREFIX) || key.startsWith(CANVAS_V1_BACKUP_PREFIX));
  for (const localKey of legacyKeys) {
    const dbKey = dbKeyForLocalKey(localKey);
    if (!dbKey) continue;
    const raw = window.localStorage.getItem(localKey);
    if (raw === null) continue;
    const parsed = parseLocalJson<unknown>(raw, undefined);
    if (parsed === undefined || !values.has(dbKey) || !sameValue(parsed, values.get(dbKey))) continue;
    try { window.localStorage.removeItem(localKey); } catch { /* The verified IndexedDB copy remains authoritative. */ }
  }
}

async function initializeCanvasStorage() {
  let entries = await listCanvasStorageEntries();
  const hasCanvasIndex = entries.some((entry) => entry.key === DB_PROJECTS_KEY);
  let migrated = false;
  if (!hasCanvasIndex) {
    const state = legacyState();
    retainNovaBackupInLocalStorage(state.novaBackup);
    if (!state.projects.length) {
      const now = Date.now();
      state.projects.push({ id: `canvas_${now.toString(36)}`, name: '我的 AI 画布', createdAt: now, updatedAt: now });
      state.documents[state.projects[0].id] = normalizeDocument(null);
    }
    const values = dbEntriesFromState(state);
    for (const key of Object.keys(window.localStorage).filter((item) => item.startsWith(CANVAS_V1_BACKUP_PREFIX))) {
      const raw = window.localStorage.getItem(key);
      const value = raw ? parseLocalJson<unknown>(raw, null) : null;
      if (value) values.set(`${DB_V1_BACKUP_PREFIX}${key.slice(CANVAS_V1_BACKUP_PREFIX.length)}`, value);
    }
    const keys = [...values.keys()];
    const imported = await transactCanvasStorage(keys, (current) => current.has(DB_PROJECTS_KEY)
      ? { result: false, mutations: [] }
      : {
          result: true,
          mutations: [...values].map(([key, value]) => ({ type: 'put' as const, key, value })),
        });
    entries = await listCanvasStorageEntries();
    if (imported) {
      const persisted = new Map(entries.map((entry) => [entry.key, entry.value] as const));
      if ([...values].some(([key, value]) => !persisted.has(key) || !sameValue(persisted.get(key), value))) {
        throw new Error('Canvas IndexedDB 校验失败，旧数据已保留');
      }
      migrated = true;
    }
    if (imported && state.legacySource) {
      // This marker is only a local compatibility projection; the IndexedDB
      // migration record remains authoritative when localStorage is full.
      writeJson(MIGRATION_KEY, { migratedAt: new Date().toISOString(), source: 'nova.v1', backupKey: MIGRATION_BACKUP_KEY });
    }
  }
  hydrateCanvasCache(entries);
  const currentProjects = readCanvasProjects();
  if (currentProjects.some((project) => !project.projectId)) {
    const identity = await persistProjectIdentity(currentProjects);
    if (!identity.saved) throw new Error(describeCanvasSaveFailure());
  }
  entries = await listCanvasStorageEntries();
  legacyRecordsMatchDatabase(entries);
  compactRetainedNovaBackup();
  cleanupBackedUpNovaSources(entries);
  const projects = readCanvasProjects();
  const selectedId = tabActiveProjectId(projects);
  return { projects, activeId: selectedId || projects[0]?.id || '', migrated };
}

export function ensureCanvasStorage() {
  if (canvasCache.initialized) {
    const projects = readCanvasProjects();
    return Promise.resolve({ projects, activeId: tabActiveProjectId(projects) || projects[0]?.id || '', migrated: false });
  }
  if (ensureStoragePromise) return ensureStoragePromise;
  ensureStoragePromise = initializeCanvasStorage().catch((error) => {
    ensureStoragePromise = null;
    throw error;
  });
  return ensureStoragePromise;
}

export const CANVAS_PROJECT_PREFIX = 'sanmao.canvas.project.';

export function loadCanvasDocument(id: string) {
  return canvasCache.initialized
    ? normalizeDocument(canvasCache.documents[id] || null)
    : normalizeDocument(readJson(`${CANVAS_PROJECT_PREFIX}${id}`, null));
}

export function readCanvasDeletionTombstones(): CanvasDeletionTombstones {
  return canvasCache.initialized
    ? normalizeDeletionTombstones(canvasCache.tombstones)
    : normalizeDeletionTombstones(readJson(CANVAS_DELETION_TOMBSTONES_KEY, {}));
}

export function clearCanvasDeletionTombstones() {
  return writeCanvasEntries(new Map([[CANVAS_DELETION_TOMBSTONES_KEY, JSON.stringify({})]]), undefined, false);
}

export async function saveCanvasDocument(id: string, document: CanvasDocument, expectedDocument?: CanvasDocument) {
  storageQuotaExceeded = false;
  storageConflict = false;
  storageInlineImagesPending = false;
  if (canvasInlineImageUrls(document.nodes).length) {
    storageInlineImagesPending = true;
    return false;
  }
  const key = `${CANVAS_PROJECT_PREFIX}${id}`;
  const current = canvasCache.documents[id] || normalizeDocument(null);
  const projects = readCanvasProjects();
  if (!projects.some((project) => project.id === id) || (expectedDocument && JSON.stringify(normalizeDocument(current)) !== JSON.stringify(normalizeDocument(expectedDocument)))) {
    storageConflict = true;
    return false;
  }
  const normalized = { ...normalizeDocument(document), version: CANVAS_VERSION };
  if (current && JSON.stringify(normalizeDocument(current)) === JSON.stringify(normalized)) return true;
  // Document and identity metadata must succeed together; never acknowledge a partial save.
  const tombstones = expectedDocument
    ? updateDeletionTombstones(readCanvasDeletionTombstones(), id, normalizeDocument(expectedDocument), normalized)
    : readCanvasDeletionTombstones();
  const updatedProjects = projects.map((project) => project.id === id ? { ...project, updatedAt: Date.now() } : project);
  const entries = new Map([
    [key, JSON.stringify(normalized)],
    [CANVAS_DELETION_TOMBSTONES_KEY, JSON.stringify(tombstones)],
  ]);
  let identity = await persistProjectIdentity(updatedProjects, readCreativeProjects(), entries);
  if (!identity.saved && storageQuotaExceeded) {
    let candidate = identity.creativeProjects;
    let prunedAutomaticVersions = 0;
    while (!identity.saved && storageQuotaExceeded) {
      const pruned = pruneOldestAutomaticCreativeProjectVersion(candidate);
      if (!pruned) break;
      candidate = pruned.projects;
      prunedAutomaticVersions += 1;
      // Keep checkpoint pruning in the same transaction as the document save.
      // If this attempt fails, IndexedDB retains both the original metadata and
      // the previously saved document.
      identity = await persistProjectIdentity(updatedProjects, candidate, entries);
    }
    if (identity.saved) storagePrunedAutomaticCheckpoints += prunedAutomaticVersions;
  }
  const ok = identity.saved;
  if (ok) emitWorkspaceChange();
  if (ok) storageInlineImagesPending = false;
  return ok;
}

export async function saveCanvasProjects(projects: CanvasProject[], activeId: string) {
  // Compatibility writes never interpret an omitted row as a deletion.
  const latest = readCanvasProjects();
  const incoming = new Map(projects.map((project) => [project.id, project]));
  const merged = latest.map((project) => {
    const candidate = incoming.get(project.id);
    incoming.delete(project.id);
    return candidate && candidate.updatedAt > project.updatedAt ? candidate : project;
  });
  const nextProjects = [...incoming.values(), ...merged];
  if (!nextProjects.some((project) => project.id === activeId)) return false;
  const identity = await persistProjectIdentity(nextProjects, readCreativeProjects(), new Map([
    [CANVAS_ACTIVE_KEY, JSON.stringify(activeId)],
  ]));
  const ok = identity.saved;
  if (ok) {
    try { window.sessionStorage.setItem(CANVAS_TAB_ACTIVE_KEY, activeId); } catch {}
  }
  if (ok) emitWorkspaceChange();
  return ok;
}

export async function createCanvasProject(project: CanvasProject, document: CanvasDocument) {
  storageConflict = false;
  const latest = readCanvasProjects();
  if (latest.some((item) => item.id === project.id)) return false;
  // Write the document before publishing its index row, so a failed media-heavy save cannot create an empty project.
  if (!(await persistProjectIdentity([project, ...latest], readCreativeProjects(), new Map([
    [`${CANVAS_PROJECT_PREFIX}${project.id}`, JSON.stringify(normalizeDocument(document))],
    [CANVAS_ACTIVE_KEY, JSON.stringify(project.id)],
  ]))).saved) return false;
  try { window.sessionStorage.setItem(CANVAS_TAB_ACTIVE_KEY, project.id); } catch {}
  emitWorkspaceChange();
  return true;
}

export async function renameCanvasProject(id: string, name: string) {
  const latest = readCanvasProjects();
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || !latest.some((project) => project.id === id)) return false;
  const identity = await persistProjectIdentity(latest.map((project) => project.id === id ? { ...project, name: trimmed, updatedAt: Date.now() } : project));
  if (identity.saved) emitWorkspaceChange();
  return identity.saved;
}

export async function deleteCanvasProject(id: string) {
  const latest = readCanvasProjects();
  if (latest.length <= 1 || !latest.some((project) => project.id === id)) return false;
  const next = latest.filter((project) => project.id !== id);
  const tombstones = readCanvasDeletionTombstones();
  delete tombstones[id];
  if (!(await persistProjectIdentity(next, readCreativeProjects(), new Map([
    [`${CANVAS_PROJECT_PREFIX}${id}`, null],
    [CANVAS_DELETION_TOMBSTONES_KEY, JSON.stringify(tombstones)],
  ]))).saved) return false;
  emitWorkspaceChange();
  return true;
}

export function readCanvasUi<T extends Record<string, unknown>>() {
  return (canvasCache.initialized ? canvasCache.ui : readJson<T>(CANVAS_UI_KEY, {} as T)) as T;
}

export function writeCanvasUi(value: Record<string, unknown>) {
  return writeCanvasEntries(new Map([[CANVAS_UI_KEY, JSON.stringify(value)]]));
}

export function canvasProjectFromDocument(name: string, document: CanvasDocument): string {
  return JSON.stringify({ version: document.version, name, nodes: document.nodes, edges: document.edges, groups: document.groups, camera: document.camera, exportedAt: new Date().toISOString() }, null, 2);
}

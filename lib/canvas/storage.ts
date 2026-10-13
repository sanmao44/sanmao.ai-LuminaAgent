import type { CanvasDocument, CanvasProject } from './types';
import { CANVAS_VERSION, normalizeDocument } from './model';
import { emitWorkspaceChange } from '../workspace-events';
import type { CanvasWorkspaceData } from '../workspace-types';
import {
  CREATIVE_PROJECTS_KEY,
  normalizeCreativeProjects,
  readCreativeProjects,
  reconcileCreativeProjects,
} from '../creative-projects';

export const CANVAS_PROJECTS_KEY = 'sanmao.canvas.projects';
export const CANVAS_ACTIVE_KEY = 'sanmao.canvas.active';
export const CANVAS_UI_KEY = 'sanmao.canvas.ui';
const CANVAS_TAB_ACTIVE_KEY = 'sanmao.canvas.tab-active';
const NOVA_PROJECTS_KEY = 'nova.v1.projects';
const NOVA_ACTIVE_KEY = 'nova.v1.active';
const NOVA_PROJECT_PREFIX = 'nova.v1.project.';
const MIGRATION_KEY = 'sanmao.canvas.nova-migrated';
const MIGRATION_BACKUP_KEY = 'sanmao.canvas.nova-backup';
export const CANVAS_V1_BACKUP_PREFIX = 'sanmao.canvas.v1-backup.';

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

let storageQuotaExceeded = false;
let storageConflict = false;

function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    storageQuotaExceeded = false;
    return true;
  } catch (error) {
    storageQuotaExceeded = isQuotaExceededError(error);
    return false;
  }
}

/** Synchronous adapter transaction: failed multi-key writes retain the original canvas. */
function writeCanvasEntries(entries: ReadonlyMap<string, string | null>) {
  const previous = new Map<string, string | null>();
  try {
    for (const key of entries.keys()) previous.set(key, window.localStorage.getItem(key));
    for (const [key, value] of entries) {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    }
    storageQuotaExceeded = false;
    return true;
  } catch (error) {
    storageQuotaExceeded = isQuotaExceededError(error);
    for (const [key, value] of previous) {
      if (value === null) { try { window.localStorage.removeItem(key); } catch {} }
    }
    for (const [key, value] of previous) {
      if (value !== null) { try { window.localStorage.setItem(key, value); } catch {} }
    }
    return false;
  }
}

/** 最近一次画布写入失败的提示：区分浏览器存储配额不足与其它写入失败。 */
export function describeCanvasSaveFailure() {
  if (storageConflict) return '这个画布已在其他页面更新或删除，当前内容已保留，请先导出工作流 JSON，再重新打开画布。';
  return storageQuotaExceeded
    ? '浏览器本地存储已满：请先导出工作流 JSON，再清理生成任务记录或删除无用画布。'
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

function activeProjectId(projects: CanvasProject[], value: unknown) {
  const activeId = typeof value === 'string' ? value : '';
  return projects.some((project) => project.id === activeId) ? activeId : projects[0]?.id || null;
}

/** Current selection belongs to this tab; the snapshot activeId is only a startup default. */
export function retainedCanvasProjectId(projects: CanvasProject[], currentId: string | null, defaultId: string | null) {
  return activeProjectId(projects, currentId && projects.some((project) => project.id === currentId) ? currentId : defaultId);
}

export function readCanvasProjects() {
  return normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
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
  return writeJson(CANVAS_ACTIVE_KEY, id);
}

function persistProjectIdentity(projects: CanvasProject[], storedProjects = readCreativeProjects(), entries = new Map<string, string | null>()) {
  const preferredProjectId = projects.length === 1 && typeof window !== 'undefined'
    ? (() => {
        try {
          const raw = JSON.parse(window.localStorage.getItem('sanmao.workspace.context.v1') || 'null');
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
  const saved = writeCanvasEntries(entries);
  return { ...identity, saved };
}

/** Reads the current canvas without creating a project during workspace bootstrap. */
export function readCanvasWorkspace(): CanvasWorkspaceData {
  let projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (!projects.length && normalizeProjects(readJson(NOVA_PROJECTS_KEY, [])).length) {
    ensureCanvasStorage();
    projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  }
  const needsIdentity = projects.some((project) => !project.projectId);
  const identity = reconcileCreativeProjects(projects, readCreativeProjects());
  projects = identity.canvasProjects;
  // Snapshot collection is a read. Rewriting the index here can publish a
  // stale list over a project created by another tab between storage reads.
  if (needsIdentity) {
    persistProjectIdentity(projects);
  }
  const documents = projects.reduce<Record<string, CanvasDocument>>((result, project) => {
    const value = readJson<unknown>(`${CANVAS_PROJECT_PREFIX}${project.id}`, null);
    if (value) result[project.id] = normalizeDocument(value);
    return result;
  }, {});
  return {
    projects,
    activeId: activeProjectId(projects, readJson(CANVAS_ACTIVE_KEY, null)),
    documents,
    ui: readJson<Record<string, unknown>>(CANVAS_UI_KEY, {}),
    creativeProjects: identity.creativeProjects,
  };
}

export function restoreCanvasWorkspace(value: Partial<CanvasWorkspaceData> | null | undefined) {
  const identity = reconcileCreativeProjects(normalizeProjects(value?.projects), normalizeCreativeProjects(value?.creativeProjects));
  const projects = identity.canvasProjects;
  const activeId = activeProjectId(projects, value?.activeId);
  const previous = new Map<string, string | null>();
  try {
    const documentKeys = Object.keys(window.localStorage).filter((key) => key.startsWith(CANVAS_PROJECT_PREFIX));
    const nextDocumentKeys = projects.map((project) => `${CANVAS_PROJECT_PREFIX}${project.id}`);
    for (const key of [...documentKeys, ...nextDocumentKeys, CANVAS_PROJECTS_KEY, CANVAS_ACTIVE_KEY, CANVAS_UI_KEY, CREATIVE_PROJECTS_KEY]) {
      previous.set(key, window.localStorage.getItem(key));
    }
    // Keep old documents until all replacement writes succeed. Quota or I/O
    // failure must not leave an index pointing at deleted image nodes.
    const write = (key: string, data: unknown) => {
      if (!writeJson(key, data)) throw new Error('Canvas restore write failed');
    };
    projects.forEach((project) => write(`${CANVAS_PROJECT_PREFIX}${project.id}`, normalizeDocument(value?.documents?.[project.id] || null)));
    write(CANVAS_PROJECTS_KEY, projects);
    write(CANVAS_ACTIVE_KEY, activeId);
    write(CANVAS_UI_KEY, value?.ui && typeof value.ui === 'object' ? value.ui : {});
    write(CREATIVE_PROJECTS_KEY, normalizeCreativeProjects(identity.creativeProjects));
    const retained = new Set(nextDocumentKeys);
    documentKeys.filter((key) => !retained.has(key)).forEach((key) => window.localStorage.removeItem(key));
    return true;
  } catch {
    // Remove newly allocated entries first to release space for the originals.
    for (const [key, data] of previous) {
      if (data === null) { try { window.localStorage.removeItem(key); } catch {} }
    }
    for (const [key, data] of previous) {
      if (data !== null) { try { window.localStorage.setItem(key, data); } catch {} }
    }
    return false;
  }
}

export function ensureCanvasStorage() {
  const current = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (current.length) {
    // Established projects need no hydration writes. Storage-event refreshes
    // must not bounce stale project indexes back into the shared cache.
    const identity = current.every((project) => project.projectId)
      ? reconcileCreativeProjects(current, readCreativeProjects())
      : persistProjectIdentity(current);
    return { projects: identity.canvasProjects, activeId: tabActiveProjectId(identity.canvasProjects)!, migrated: false };
  }
  const legacy = normalizeProjects(readJson(NOVA_PROJECTS_KEY, []));
  if (legacy.length) {
    const legacyDocuments = legacy.reduce<Record<string, CanvasDocument>>((result, project) => {
      const legacyDocument = readJson<unknown>(`${NOVA_PROJECT_PREFIX}${project.id}`, null);
      if (legacyDocument) result[project.id] = normalizeDocument(legacyDocument);
      return result;
    }, {});
    const activeId = readJson<string | null>(NOVA_ACTIVE_KEY, null);
    const entries = new Map<string, string | null>([
      [CANVAS_ACTIVE_KEY, JSON.stringify(activeId && legacy.some((project) => project.id === activeId) ? activeId : legacy[0].id)],
      [MIGRATION_BACKUP_KEY, JSON.stringify({ backedUpAt: new Date().toISOString(), source: 'nova.v1', projects: legacy, activeId, documents: legacyDocuments })],
      [MIGRATION_KEY, JSON.stringify({ migratedAt: new Date().toISOString(), source: 'nova.v1', backupKey: MIGRATION_BACKUP_KEY })],
    ]);
    legacy.forEach((project) => {
      entries.set(`${CANVAS_PROJECT_PREFIX}${project.id}`, JSON.stringify(legacyDocuments[project.id] || normalizeDocument(null)));
    });
    const identity = persistProjectIdentity(legacy, readCreativeProjects(), entries);
    if (!identity.saved) throw new Error(describeCanvasSaveFailure());
    return { projects: identity.canvasProjects, activeId: tabActiveProjectId(identity.canvasProjects)!, migrated: true };
  }
  const project: CanvasProject = { id: `canvas_${Date.now().toString(36)}`, name: '我的 AI 画布', createdAt: Date.now(), updatedAt: Date.now() };
  if (!createCanvasProject(project, normalizeDocument(null))) throw new Error(describeCanvasSaveFailure());
  const projects = readCanvasProjects();
  return { projects, activeId: tabActiveProjectId(projects)!, migrated: false };
}

export const CANVAS_PROJECT_PREFIX = 'sanmao.canvas.project.';

export function loadCanvasDocument(id: string) {
  return normalizeDocument(readJson(`${CANVAS_PROJECT_PREFIX}${id}`, null));
}

export function saveCanvasDocument(id: string, document: CanvasDocument, expectedDocument?: CanvasDocument) {
  storageQuotaExceeded = false;
  storageConflict = false;
  const key = `${CANVAS_PROJECT_PREFIX}${id}`;
  const current = readJson<Record<string, unknown> | null>(key, null);
  const projects = readCanvasProjects();
  if (!projects.some((project) => project.id === id) || (expectedDocument && JSON.stringify(normalizeDocument(current)) !== JSON.stringify(normalizeDocument(expectedDocument)))) {
    storageConflict = true;
    return false;
  }
  const normalized = { ...normalizeDocument(document), version: CANVAS_VERSION };
  if (current && JSON.stringify(normalizeDocument(current)) === JSON.stringify(normalized)) return true;
  if (current && current.version !== CANVAS_VERSION) {
    const backupKey = `${CANVAS_V1_BACKUP_PREFIX}${id}`;
    try {
      if (!window.localStorage.getItem(backupKey)) window.localStorage.setItem(backupKey, JSON.stringify({ backedUpAt: new Date().toISOString(), sourceVersion: current.version || 'nova-compatible', document: current }));
    } catch (error) {
      storageQuotaExceeded = isQuotaExceededError(error);
      return false;
    }
  }
  // Document and identity metadata must succeed together; never acknowledge a partial save.
  const ok = persistProjectIdentity(
    projects.map((project) => project.id === id ? { ...project, updatedAt: Date.now() } : project),
    readCreativeProjects(),
    new Map([[key, JSON.stringify(normalized)]]),
  ).saved;
  if (ok) emitWorkspaceChange();
  return ok;
}

export function saveCanvasProjects(projects: CanvasProject[], activeId: string) {
  // Compatibility writes never interpret an omitted row as a deletion.
  const latest = readCanvasProjects();
  const incoming = new Map(projects.map((project) => [project.id, project]));
  const merged = latest.map((project) => {
    const candidate = incoming.get(project.id);
    incoming.delete(project.id);
    return candidate && candidate.updatedAt > project.updatedAt ? candidate : project;
  });
  const identity = persistProjectIdentity([...incoming.values(), ...merged]);
  const ok = identity.saved && saveCanvasActiveProject(activeId);
  if (ok) emitWorkspaceChange();
  return ok;
}

export function createCanvasProject(project: CanvasProject, document: CanvasDocument) {
  storageConflict = false;
  const latest = readCanvasProjects();
  if (latest.some((item) => item.id === project.id)) return false;
  // Write the document before publishing its index row, so a failed media-heavy save cannot create an empty project.
  if (!persistProjectIdentity([project, ...latest], readCreativeProjects(), new Map([
    [`${CANVAS_PROJECT_PREFIX}${project.id}`, JSON.stringify(normalizeDocument(document))],
    [CANVAS_ACTIVE_KEY, JSON.stringify(project.id)],
  ])).saved) return false;
  saveCanvasActiveProject(project.id);
  emitWorkspaceChange();
  return true;
}

export function renameCanvasProject(id: string, name: string) {
  const latest = readCanvasProjects();
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || !latest.some((project) => project.id === id)) return false;
  const identity = persistProjectIdentity(latest.map((project) => project.id === id ? { ...project, name: trimmed, updatedAt: Date.now() } : project));
  if (identity.saved) emitWorkspaceChange();
  return identity.saved;
}

export function deleteCanvasProject(id: string) {
  const latest = readCanvasProjects();
  if (latest.length <= 1 || !latest.some((project) => project.id === id)) return false;
  const next = latest.filter((project) => project.id !== id);
  if (!persistProjectIdentity(next, readCreativeProjects(), new Map([[`${CANVAS_PROJECT_PREFIX}${id}`, null]])).saved) return false;
  emitWorkspaceChange();
  return true;
}

export function readCanvasUi<T extends Record<string, unknown>>() {
  return readJson<T>(CANVAS_UI_KEY, {} as T);
}

export function writeCanvasUi(value: Record<string, unknown>) {
  const ok = writeJson(CANVAS_UI_KEY, value);
  if (ok) emitWorkspaceChange();
  return ok;
}

export function canvasProjectFromDocument(name: string, document: CanvasDocument): string {
  return JSON.stringify({ version: document.version, name, nodes: document.nodes, edges: document.edges, groups: document.groups, camera: document.camera, exportedAt: new Date().toISOString() }, null, 2);
}

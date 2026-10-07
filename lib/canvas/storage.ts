import type { CanvasDocument, CanvasProject } from './types';
import { CANVAS_VERSION, normalizeDocument } from './model';
import { emitWorkspaceChange } from '../workspace-events';
import type { CanvasWorkspaceData } from '../workspace-types';
import {
  normalizeCreativeProjects,
  readCreativeProjects,
  reconcileCreativeProjects,
  saveCreativeProjects,
} from '../creative-projects';

export const CANVAS_PROJECTS_KEY = 'sanmao.canvas.projects';
export const CANVAS_ACTIVE_KEY = 'sanmao.canvas.active';
export const CANVAS_UI_KEY = 'sanmao.canvas.ui';
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

/** 最近一次画布写入失败的提示：区分浏览器存储配额不足与其它写入失败。 */
export function describeCanvasSaveFailure() {
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

function persistProjectIdentity(projects: CanvasProject[], storedProjects = readCreativeProjects()) {
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
  writeJson(CANVAS_PROJECTS_KEY, identity.canvasProjects);
  saveCreativeProjects(identity.creativeProjects);
  return identity;
}

/** Reads the current canvas without creating a project during workspace bootstrap. */
export function readCanvasWorkspace(): CanvasWorkspaceData {
  let projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (!projects.length && normalizeProjects(readJson(NOVA_PROJECTS_KEY, [])).length) {
    ensureCanvasStorage();
    projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  }
  const identity = reconcileCreativeProjects(projects, readCreativeProjects());
  projects = identity.canvasProjects;
  writeJson(CANVAS_PROJECTS_KEY, projects);
  saveCreativeProjects(identity.creativeProjects);
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
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(CANVAS_PROJECT_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch { return false; }
  const okProjects = writeJson(CANVAS_PROJECTS_KEY, projects);
  const okActive = activeId ? writeJson(CANVAS_ACTIVE_KEY, activeId) : writeJson(CANVAS_ACTIVE_KEY, null);
  const okUi = writeJson(CANVAS_UI_KEY, value?.ui && typeof value.ui === 'object' ? value.ui : {});
  const okCreativeProjects = saveCreativeProjects(identity.creativeProjects);
  const okDocuments = projects.every((project) => {
    const document = value?.documents?.[project.id];
    return writeJson(`${CANVAS_PROJECT_PREFIX}${project.id}`, normalizeDocument(document || null));
  });
  return okProjects && okActive && okUi && okDocuments && okCreativeProjects;
}

export function ensureCanvasStorage() {
  const current = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (current.length) {
    const identity = persistProjectIdentity(current);
    return { projects: identity.canvasProjects, activeId: readJson<string | null>(CANVAS_ACTIVE_KEY, null) || identity.canvasProjects[0].id, migrated: false };
  }
  const legacy = normalizeProjects(readJson(NOVA_PROJECTS_KEY, []));
  if (legacy.length) {
    const legacyDocuments = legacy.reduce<Record<string, CanvasDocument>>((result, project) => {
      const legacyDocument = readJson<unknown>(`${NOVA_PROJECT_PREFIX}${project.id}`, null);
      if (legacyDocument) result[project.id] = normalizeDocument(legacyDocument);
      return result;
    }, {});
    writeJson(CANVAS_PROJECTS_KEY, legacy);
    const activeId = readJson<string | null>(NOVA_ACTIVE_KEY, null);
    writeJson(CANVAS_ACTIVE_KEY, activeId && legacy.some((project) => project.id === activeId) ? activeId : legacy[0].id);
    legacy.forEach((project) => { if (legacyDocuments[project.id]) writeJson(`${CANVAS_PROJECT_PREFIX}${project.id}`, legacyDocuments[project.id]); });
    writeJson(MIGRATION_BACKUP_KEY, { backedUpAt: new Date().toISOString(), source: 'nova.v1', projects: legacy, activeId, documents: legacyDocuments });
    writeJson(MIGRATION_KEY, { migratedAt: new Date().toISOString(), source: 'nova.v1', backupKey: MIGRATION_BACKUP_KEY });
    const identity = persistProjectIdentity(legacy);
    return { projects: identity.canvasProjects, activeId: activeId && identity.canvasProjects.some((project) => project.id === activeId) ? activeId : identity.canvasProjects[0].id, migrated: true };
  }
  const project: CanvasProject = { id: `canvas_${Date.now().toString(36)}`, name: '我的 AI 画布', createdAt: Date.now(), updatedAt: Date.now() };
  const identity = persistProjectIdentity([project]);
  writeJson(CANVAS_PROJECTS_KEY, identity.canvasProjects);
  writeJson(CANVAS_ACTIVE_KEY, project.id);
  writeJson(`${CANVAS_PROJECT_PREFIX}${project.id}`, normalizeDocument(null));
  return { projects: identity.canvasProjects, activeId: project.id, migrated: false };
}

export const CANVAS_PROJECT_PREFIX = 'sanmao.canvas.project.';

export function loadCanvasDocument(id: string) {
  return normalizeDocument(readJson(`${CANVAS_PROJECT_PREFIX}${id}`, null));
}

export function saveCanvasDocument(id: string, document: CanvasDocument) {
  storageQuotaExceeded = false;
  const key = `${CANVAS_PROJECT_PREFIX}${id}`;
  const current = readJson<Record<string, unknown> | null>(key, null);
  if (current && current.version !== CANVAS_VERSION) {
    const backupKey = `${CANVAS_V1_BACKUP_PREFIX}${id}`;
    try {
      if (!window.localStorage.getItem(backupKey)) window.localStorage.setItem(backupKey, JSON.stringify({ backedUpAt: new Date().toISOString(), sourceVersion: current.version || 'nova-compatible', document: current }));
    } catch (error) {
      storageQuotaExceeded = isQuotaExceededError(error);
      return false;
    }
  }
  const ok = writeJson(key, { ...normalizeDocument(document), version: CANVAS_VERSION });
  if (ok) emitWorkspaceChange();
  return ok;
}

export function saveCanvasProjects(projects: CanvasProject[], activeId: string) {
  const identity = persistProjectIdentity(projects);
  const okProjects = writeJson(CANVAS_PROJECTS_KEY, identity.canvasProjects);
  const okActive = writeJson(CANVAS_ACTIVE_KEY, activeId);
  const ok = okProjects && okActive;
  if (ok) emitWorkspaceChange();
  return ok;
}

export function deleteCanvasProject(id: string) {
  try { window.localStorage.removeItem(`${CANVAS_PROJECT_PREFIX}${id}`); } catch { return false; }
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

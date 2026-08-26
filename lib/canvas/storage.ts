import type { CanvasDocument, CanvasProject } from './types';
import { CANVAS_VERSION, normalizeDocument } from './model';
import { emitWorkspaceChange } from '../workspace-events';
import type { CanvasWorkspaceData } from '../workspace-types';

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

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function normalizeProjects(value: unknown): CanvasProject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).map((item, index) => ({
    id: String(item.id || `canvas_${index + 1}`),
    name: String(item.name || `新画布 ${index + 1}`),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
  }));
}

function activeProjectId(projects: CanvasProject[], value: unknown) {
  const activeId = typeof value === 'string' ? value : '';
  return projects.some((project) => project.id === activeId) ? activeId : projects[0]?.id || null;
}

/** Reads the current canvas without creating a project during workspace bootstrap. */
export function readCanvasWorkspace(): CanvasWorkspaceData {
  let projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (!projects.length && normalizeProjects(readJson(NOVA_PROJECTS_KEY, [])).length) {
    ensureCanvasStorage();
    projects = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
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
  };
}

export function restoreCanvasWorkspace(value: Partial<CanvasWorkspaceData> | null | undefined) {
  const projects = normalizeProjects(value?.projects);
  const activeId = activeProjectId(projects, value?.activeId);
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(CANVAS_PROJECT_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch { return false; }
  const okProjects = writeJson(CANVAS_PROJECTS_KEY, projects);
  const okActive = activeId ? writeJson(CANVAS_ACTIVE_KEY, activeId) : writeJson(CANVAS_ACTIVE_KEY, null);
  const okUi = writeJson(CANVAS_UI_KEY, value?.ui && typeof value.ui === 'object' ? value.ui : {});
  const okDocuments = projects.every((project) => {
    const document = value?.documents?.[project.id];
    return writeJson(`${CANVAS_PROJECT_PREFIX}${project.id}`, normalizeDocument(document || null));
  });
  return okProjects && okActive && okUi && okDocuments;
}

export function ensureCanvasStorage() {
  const current = normalizeProjects(readJson(CANVAS_PROJECTS_KEY, []));
  if (current.length) return { projects: current, activeId: readJson<string | null>(CANVAS_ACTIVE_KEY, null) || current[0].id, migrated: false };
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
    return { projects: legacy, activeId: activeId && legacy.some((project) => project.id === activeId) ? activeId : legacy[0].id, migrated: true };
  }
  const project: CanvasProject = { id: `canvas_${Date.now().toString(36)}`, name: '我的 AI 画布', createdAt: Date.now(), updatedAt: Date.now() };
  writeJson(CANVAS_PROJECTS_KEY, [project]);
  writeJson(CANVAS_ACTIVE_KEY, project.id);
  writeJson(`${CANVAS_PROJECT_PREFIX}${project.id}`, normalizeDocument(null));
  return { projects: [project], activeId: project.id, migrated: false };
}

export const CANVAS_PROJECT_PREFIX = 'sanmao.canvas.project.';

export function loadCanvasDocument(id: string) {
  return normalizeDocument(readJson(`${CANVAS_PROJECT_PREFIX}${id}`, null));
}

export function saveCanvasDocument(id: string, document: CanvasDocument) {
  const key = `${CANVAS_PROJECT_PREFIX}${id}`;
  const current = readJson<Record<string, unknown> | null>(key, null);
  if (current && current.version !== CANVAS_VERSION) {
    const backupKey = `${CANVAS_V1_BACKUP_PREFIX}${id}`;
    try {
      if (!window.localStorage.getItem(backupKey)) window.localStorage.setItem(backupKey, JSON.stringify({ backedUpAt: new Date().toISOString(), sourceVersion: current.version || 'nova-compatible', document: current }));
    } catch { return false; }
  }
  const ok = writeJson(key, { ...normalizeDocument(document), version: CANVAS_VERSION });
  if (ok) emitWorkspaceChange();
  return ok;
}

export function saveCanvasProjects(projects: CanvasProject[], activeId: string) {
  const okProjects = writeJson(CANVAS_PROJECTS_KEY, projects);
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

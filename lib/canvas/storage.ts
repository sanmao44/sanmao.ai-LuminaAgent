import type { CanvasDocument, CanvasProject } from './types';
import { CANVAS_VERSION, normalizeDocument } from './model';

export const CANVAS_PROJECTS_KEY = 'sanmao.canvas.projects';
export const CANVAS_ACTIVE_KEY = 'sanmao.canvas.active';
export const CANVAS_UI_KEY = 'sanmao.canvas.ui';
const NOVA_PROJECTS_KEY = 'nova.v1.projects';
const NOVA_ACTIVE_KEY = 'nova.v1.active';
const NOVA_PROJECT_PREFIX = 'nova.v1.project.';
const MIGRATION_KEY = 'sanmao.canvas.nova-migrated';
const MIGRATION_BACKUP_KEY = 'sanmao.canvas.nova-backup';

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
  return writeJson(`${CANVAS_PROJECT_PREFIX}${id}`, { ...normalizeDocument(document), version: CANVAS_VERSION });
}

export function saveCanvasProjects(projects: CanvasProject[], activeId: string) {
  const okProjects = writeJson(CANVAS_PROJECTS_KEY, projects);
  const okActive = writeJson(CANVAS_ACTIVE_KEY, activeId);
  return okProjects && okActive;
}

export function deleteCanvasProject(id: string) {
  try { window.localStorage.removeItem(`${CANVAS_PROJECT_PREFIX}${id}`); } catch { return false; }
  return true;
}

export function readCanvasUi<T extends Record<string, unknown>>() {
  return readJson<T>(CANVAS_UI_KEY, {} as T);
}

export function writeCanvasUi(value: Record<string, unknown>) {
  return writeJson(CANVAS_UI_KEY, value);
}

export function canvasProjectFromDocument(name: string, document: CanvasDocument): string {
  return JSON.stringify({ version: document.version, name, nodes: document.nodes, edges: document.edges, groups: document.groups, camera: document.camera, exportedAt: new Date().toISOString() }, null, 2);
}

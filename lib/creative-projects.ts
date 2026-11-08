import type { CanvasProject, CanvasSnapshot } from './canvas/types';
import { MAX_CREATIVE_PROJECT_REFERENCE_ASSETS, normalizeCreativeProjectBrief, type CreativeProjectBrief } from '../packages/contracts/creative';

export const CREATIVE_PROJECTS_KEY = 'sanmao.creative.projects.v1';
export const CREATIVE_PROJECT_MAX_VERSIONS = 50;
export const CREATIVE_PROJECT_MAX_AUTOMATIC_VERSIONS = 8;

export type CreativeProjectVersion = {
  id: string;
  projectId: string;
  canvasId: string;
  label: string;
  createdAt: number;
  parentVersionId?: string;
  /** Creative rules are part of the versioned project state, not global UI preferences. */
  brief?: CreativeProjectBrief | null;
  /** Stable asset identities used as project defaults for eligible generation modes. */
  referenceAssetIds?: string[];
  snapshot: CanvasSnapshot;
};

export type CreativeProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  canvasIds: string[];
  brief?: CreativeProjectBrief;
  referenceAssetIds?: string[];
  versions?: CreativeProjectVersion[];
};

export type ImportedCreativeProjectVersion = {
  id: string;
  label: string;
  createdAt: number;
  parentVersionId?: string;
  brief?: CreativeProjectBrief | null;
  referenceAssetIds?: string[];
  snapshot: CanvasSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanId(value: unknown) {
  const id = String(value || '').trim().slice(0, 300);
  return id || undefined;
}

function cleanIds(value: unknown) {
  return [...new Set(Array.isArray(value)
    ? value.map(cleanId).filter((item): item is string => Boolean(item))
    : [])].slice(0, 128);
}

function cleanReferenceAssetIds(value: unknown) {
  return [...new Set(Array.isArray(value)
    ? value.map(cleanId).filter((item): item is string => Boolean(item))
    : [])].slice(0, MAX_CREATIVE_PROJECT_REFERENCE_ASSETS);
}

function finiteTimestamp(value: unknown, fallback: number) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizeSnapshot(value: unknown): CanvasSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups) || !isRecord(value.camera)) return null;
  return value as unknown as CanvasSnapshot;
}

export function creativeProjectSnapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeVersion(value: unknown, projectId: string): CreativeProjectVersion | null {
  if (!isRecord(value)) return null;
  const id = cleanId(value.id);
  const canvasId = cleanId(value.canvasId);
  const snapshot = normalizeSnapshot(value.snapshot);
  if (!id || !canvasId || !snapshot) return null;
  const createdAt = finiteTimestamp(value.createdAt, Date.now());
  const hasBrief = Object.prototype.hasOwnProperty.call(value, 'brief');
  const brief = normalizeCreativeProjectBrief(value.brief);
  const referenceAssetIds = cleanReferenceAssetIds(value.referenceAssetIds);
  return {
    id,
    projectId,
    canvasId,
    label: String(value.label || '未命名版本').trim().slice(0, 80) || '未命名版本',
    createdAt,
    ...(cleanId(value.parentVersionId) ? { parentVersionId: cleanId(value.parentVersionId) } : {}),
    ...(hasBrief ? { brief: brief || null } : {}),
    ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
    snapshot,
  };
}

export function creativeProjectIdForCanvas(canvasId: string) {
  const normalized = cleanId(canvasId) || `canvas_${Date.now().toString(36)}`;
  return `creative_${normalized.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240)}`;
}

export function normalizeCreativeProjects(value: unknown): CreativeProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = cleanId(item.id);
    if (!id) return [];
    const now = Date.now();
    const createdAt = finiteTimestamp(item.createdAt, now);
    const versions = Array.isArray(item.versions)
      ? item.versions
        .map((version) => normalizeVersion(version, id))
        .filter((version): version is CreativeProjectVersion => Boolean(version))
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-CREATIVE_PROJECT_MAX_VERSIONS)
      : [];
    const brief = normalizeCreativeProjectBrief(item.brief);
    const referenceAssetIds = cleanReferenceAssetIds(item.referenceAssetIds);
    return [{
      id,
      name: String(item.name || '未命名项目').trim().slice(0, 120) || '未命名项目',
      createdAt,
      updatedAt: finiteTimestamp(item.updatedAt, createdAt),
      canvasIds: cleanIds(item.canvasIds),
      ...(brief ? { brief } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(versions.length ? { versions } : {}),
    }];
  });
}

export function updateCreativeProjectBrief(
  projects: readonly CreativeProject[],
  projectId: string,
  value: unknown,
  updatedAt = Date.now(),
) {
  const normalized = normalizeCreativeProjects(projects);
  if (!normalized.some((project) => project.id === projectId)) return null;
  const brief = normalizeCreativeProjectBrief(value);
  return normalizeCreativeProjects(normalized.map((project) => project.id === projectId
    ? { ...project, updatedAt, ...(brief ? { brief } : { brief: undefined }) }
    : project));
}

export function updateCreativeProjectReferences(
  projects: readonly CreativeProject[],
  projectId: string,
  assetIds: readonly string[],
  updatedAt = Date.now(),
) {
  const normalized = normalizeCreativeProjects(projects);
  if (!normalized.some((project) => project.id === projectId)) return null;
  const referenceAssetIds = cleanReferenceAssetIds(assetIds);
  return normalizeCreativeProjects(normalized.map((project) => project.id === projectId
    ? { ...project, updatedAt, ...(referenceAssetIds.length ? { referenceAssetIds } : { referenceAssetIds: undefined }) }
    : project));
}

/**
 * Gives every existing canvas a stable creative-project identity while keeping
 * the old canvas id unchanged. Existing project metadata and version records
 * are preserved, including projects that currently have no canvas attached.
 */
export function reconcileCreativeProjects(
  canvasProjects: readonly CanvasProject[],
  storedProjects: readonly CreativeProject[] = [],
) {
  const normalizedStored = normalizeCreativeProjects(storedProjects);
  const projectsById = new Map(normalizedStored.map((project) => [project.id, project] as const));
  const activeCanvasIds = new Set(canvasProjects.map((project) => project.id));
  for (const project of normalizedStored) {
    projectsById.set(project.id, {
      ...project,
      canvasIds: project.canvasIds.filter((canvasId) => activeCanvasIds.has(canvasId)),
    });
  }

  const nextCanvasProjects = canvasProjects.map((canvasProject) => {
    const projectId = cleanId(canvasProject.projectId)
      || normalizedStored.find((project) => project.canvasIds.includes(canvasProject.id))?.id
      || creativeProjectIdForCanvas(canvasProject.id);
    const project = projectsById.get(projectId);
    const createdAt = finiteTimestamp(canvasProject.createdAt, Date.now());
    const updatedAt = finiteTimestamp(canvasProject.updatedAt, createdAt);
    projectsById.set(projectId, {
      ...(project || {}),
      id: projectId,
      name: String(canvasProject.name || project?.name || '未命名项目').trim().slice(0, 120) || '未命名项目',
      createdAt: Math.min(project?.createdAt || createdAt, createdAt),
      updatedAt: Math.max(project?.updatedAt || updatedAt, updatedAt),
      canvasIds: [...new Set([...(project?.canvasIds || []), canvasProject.id])],
    });
    return projectId === canvasProject.projectId ? canvasProject : { ...canvasProject, projectId };
  });

  return {
    canvasProjects: nextCanvasProjects,
    creativeProjects: [...projectsById.values()].sort((left, right) => right.updatedAt - left.updatedAt),
  };
}

export function readCreativeProjects() {
  if (typeof window === 'undefined') return [];
  try {
    return normalizeCreativeProjects(JSON.parse(window.localStorage.getItem(CREATIVE_PROJECTS_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function saveCreativeProjects(projects: readonly CreativeProject[]) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(CREATIVE_PROJECTS_KEY, JSON.stringify(normalizeCreativeProjects(projects)));
    return true;
  } catch {
    return false;
  }
}

export function appendCreativeProjectVersion(
  projects: readonly CreativeProject[],
  projectId: string,
  input: Omit<CreativeProjectVersion, 'projectId'>,
) {
  const project = normalizeCreativeProjects(projects).find((item) => item.id === projectId);
  if (!project) return null;
  const version: CreativeProjectVersion = {
    ...input,
    projectId: project.id,
  };
  const versions = [...(project.versions || []), version].slice(-CREATIVE_PROJECT_MAX_VERSIONS);
  return normalizeCreativeProjects(projects.map((item) => item.id === project.id
    ? { ...item, updatedAt: version.createdAt, versions }
    : item));
}

export function appendAutomaticCreativeProjectVersion(
  projects: readonly CreativeProject[],
  projectId: string,
  input: Omit<CreativeProjectVersion, 'id' | 'projectId'>,
  triggerIds: readonly string[],
) {
  const normalized = normalizeCreativeProjects(projects);
  const project = normalized.find((item) => item.id === projectId);
  const normalizedTriggerIds = [...new Set(triggerIds.map(cleanId).filter((id): id is string => Boolean(id)))].sort();
  if (!project || !normalizedTriggerIds.length) return null;

  const id = `auto_${normalizedTriggerIds[0]}`;
  const versions = project.versions || [];
  if (versions.some((version) => version.id === id)) return null;
  if (versions.at(-1) && creativeProjectSnapshotsEqual(versions.at(-1)!.snapshot, input.snapshot)) return null;

  const manualVersions = versions.filter((version) => !version.id.startsWith('auto_'));
  const automaticVersions = versions.filter((version) => version.id.startsWith('auto_'));
  const automaticCapacity = Math.min(
    CREATIVE_PROJECT_MAX_AUTOMATIC_VERSIONS - 1,
    CREATIVE_PROJECT_MAX_VERSIONS - manualVersions.length - 1,
  );
  if (automaticCapacity < 0) return null;

  const retainedAutomaticVersions = automaticCapacity > 0
    ? automaticVersions.slice(-automaticCapacity)
    : [];
  const retainedVersions = [...manualVersions, ...retainedAutomaticVersions]
    .sort((left, right) => left.createdAt - right.createdAt);
  const parentVersionId = retainedVersions.at(-1)?.id;
  const version: CreativeProjectVersion = {
    ...input,
    id,
    projectId: project.id,
    ...(parentVersionId ? { parentVersionId } : { parentVersionId: undefined }),
  };
  const nextVersions = [...retainedVersions, version]
    .sort((left, right) => left.createdAt - right.createdAt);
  if (nextVersions.length > CREATIVE_PROJECT_MAX_VERSIONS) return null;

  return normalizeCreativeProjects(normalized.map((item) => item.id === project.id
    ? { ...item, updatedAt: version.createdAt, versions: nextVersions }
    : item));
}

export function appendImportedCreativeProjectVersions(
  projects: readonly CreativeProject[],
  projectId: string,
  canvasId: string,
  incoming: readonly ImportedCreativeProjectVersion[],
  now = Date.now(),
) {
  const normalized = normalizeCreativeProjects(projects);
  const project = normalized.find((item) => item.id === projectId);
  if (!project || !incoming.length) return null;

  const existingIds = new Set((project.versions || []).map((version) => version.id));
  const importedIds = new Map<string, string>();
  const candidates = incoming.map((version, index) => {
    const incomingId = cleanId(version.id) || `version-${index + 1}`;
    const baseId = `${incomingId.startsWith('auto_') ? 'auto_imported_' : 'imported-'}${incomingId}`;
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) id = `${baseId}-${suffix++}`;
    existingIds.add(id);
    importedIds.set(version.id, id);
    return { version, index, id };
  });
  const imported = candidates.map(({ version, index, id }) => {
    return {
      id,
      projectId,
      canvasId,
      label: String(version.label || '未命名版本').trim().slice(0, 80) || '未命名版本',
      createdAt: finiteTimestamp(version.createdAt, now + index),
      ...(version.parentVersionId && importedIds.has(version.parentVersionId)
        ? { parentVersionId: importedIds.get(version.parentVersionId) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(version, 'brief') ? { brief: normalizeCreativeProjectBrief(version.brief) } : {}),
      ...(Object.prototype.hasOwnProperty.call(version, 'referenceAssetIds') ? { referenceAssetIds: cleanReferenceAssetIds(version.referenceAssetIds) } : {}),
      snapshot: version.snapshot,
    } satisfies CreativeProjectVersion;
  });
  const next = normalizeCreativeProjects(normalized.map((item) => item.id === projectId
    ? { ...item, updatedAt: now, versions: [...(item.versions || []), ...imported] }
    : item));
  return { projects: next, importedCount: imported.length };
}

export function removeCreativeProjectVersion(
  projects: readonly CreativeProject[],
  projectId: string,
  versionId: string,
) {
  const normalized = normalizeCreativeProjects(projects);
  const project = normalized.find((item) => item.id === projectId);
  if (!project?.versions?.some((version) => version.id === versionId)) return null;
  return normalizeCreativeProjects(normalized.map((item) => item.id === projectId
    ? { ...item, versions: item.versions?.filter((version) => version.id !== versionId) }
    : item));
}

export function creativeProjectVersion(projects: readonly CreativeProject[], projectId: string, versionId: string) {
  return normalizeCreativeProjects(projects)
    .find((project) => project.id === projectId)
    ?.versions?.find((version) => version.id === versionId) || null;
}

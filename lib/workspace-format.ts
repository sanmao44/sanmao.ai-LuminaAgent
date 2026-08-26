export const WORKSPACE_SCHEMA_VERSION = 1;

type WorkspaceShape = {
  schemaVersion: number;
  updatedAt: number;
  clientId: string;
  canvas: { projects: unknown[]; documents: Record<string, unknown>; ui: Record<string, unknown> };
  gallery: unknown[];
  chatSessions: unknown[];
  assetIndex: unknown[];
  assetCollections: Array<{ builtin?: boolean }>;
  preferences: Record<string, string>;
};

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function validateWorkspaceShape(value: unknown) {
  if (!isObject(value) || value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error('工作区版本不受支持');
  if (!Number.isFinite(Number(value.updatedAt)) || typeof value.clientId !== 'string' || !value.clientId.trim()) throw new Error('工作区元数据无效');
  if (!isObject(value.canvas) || !Array.isArray(value.canvas.projects) || !isObject(value.canvas.documents) || !isObject(value.canvas.ui)) throw new Error('工作区画布数据无效');
  if (!Array.isArray(value.gallery) || !Array.isArray(value.chatSessions) || !Array.isArray(value.assetIndex) || !Array.isArray(value.assetCollections) || !isObject(value.preferences)) throw new Error('工作区历史数据无效');
  for (const [key, item] of Object.entries(value.preferences)) if (typeof key !== 'string' || typeof item !== 'string') throw new Error('工作区偏好格式无效');
  return value as WorkspaceShape;
}

export function workspaceContentSignature(snapshot: WorkspaceShape) {
  const content = JSON.stringify({
    canvas: snapshot.canvas,
    gallery: snapshot.gallery,
    chatSessions: snapshot.chatSessions,
    assetIndex: snapshot.assetIndex,
    assetCollections: snapshot.assetCollections,
    preferences: snapshot.preferences,
  });
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}

export function workspaceHasData(snapshot: WorkspaceShape) {
  return snapshot.canvas.projects.length > 0
    || Object.keys(snapshot.canvas.documents).length > 0
    || snapshot.gallery.length > 0
    || snapshot.chatSessions.length > 0
    || snapshot.assetIndex.length > 0
    || snapshot.assetCollections.some((item) => !item.builtin)
    || Object.keys(snapshot.preferences).length > 0;
}

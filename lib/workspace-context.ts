export const WORKSPACE_CONTEXT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_CONTEXT_KEY = "sanmao.workspace.context.v1";

export type WorkspaceContext = {
  schemaVersion: typeof WORKSPACE_CONTEXT_SCHEMA_VERSION;
  /** Stable local scope shared by Agent, Canvas, tasks and provenance records. */
  creativeProjectId: string;
  chatId?: string;
  canvasId?: string;
  selectedNodeIds: string[];
  assetIds: string[];
  updatedAt: number;
};

type WorkspaceContextPatch = Partial<Omit<WorkspaceContext, "schemaVersion" | "updatedAt">>;

function cleanIds(value: unknown, limit = 64) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item || "").trim().slice(0, 300))
    .filter(Boolean))].slice(0, limit);
}

function cleanScopeId(value: unknown, fallback?: string) {
  const normalized = String(value || fallback || "").trim().slice(0, 300);
  return normalized || undefined;
}

function newCreativeProjectId() {
  try {
    return `creative_${crypto.randomUUID()}`;
  } catch {
    return `creative_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function newChatId() {
  try {
    return `chat_${crypto.randomUUID()}`;
  } catch {
    return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function normalizeWorkspaceContext(value: unknown, fallback?: Partial<WorkspaceContext>): WorkspaceContext {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallbackValue = fallback || {};
  const creativeProjectId = cleanScopeId(input.creativeProjectId, fallbackValue.creativeProjectId) || newCreativeProjectId();
  const chatId = cleanScopeId(input.chatId, fallbackValue.chatId) || newChatId();
  const canvasId = cleanScopeId(input.canvasId, fallbackValue.canvasId);
  return {
    schemaVersion: WORKSPACE_CONTEXT_SCHEMA_VERSION,
    creativeProjectId,
    ...(chatId ? { chatId } : {}),
    ...(canvasId ? { canvasId } : {}),
    selectedNodeIds: cleanIds(input.selectedNodeIds ?? fallbackValue.selectedNodeIds),
    assetIds: cleanIds(input.assetIds ?? fallbackValue.assetIds),
    updatedAt: Number(input.updatedAt || fallbackValue.updatedAt) || Date.now(),
  };
}

export function readWorkspaceContext(): WorkspaceContext {
  if (typeof window === "undefined") return normalizeWorkspaceContext(null);
  try {
    const raw = window.localStorage.getItem(WORKSPACE_CONTEXT_KEY);
    const next = normalizeWorkspaceContext(raw ? JSON.parse(raw) : null);
    if (!raw) window.localStorage.setItem(WORKSPACE_CONTEXT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return normalizeWorkspaceContext(null);
  }
}

export function writeWorkspaceContext(value: WorkspaceContext) {
  const next = normalizeWorkspaceContext(value);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(WORKSPACE_CONTEXT_KEY, JSON.stringify(next)); } catch { /* local persistence is best effort */ }
  }
  return next;
}

export function updateWorkspaceContext(patch: WorkspaceContextPatch) {
  const current = readWorkspaceContext();
  return writeWorkspaceContext({ ...current, ...patch, updatedAt: Date.now() });
}

import type {
  CanvasGenerationParams,
  CanvasMediaKind,
  CanvasNode,
} from "./types";

export const CANVAS_MAX_REFERENCES = 16;

export type CanvasReferenceOrigin = "node" | "asset" | "upload" | "paste";

export type CanvasReferenceDraft = {
  id: string;
  kind: CanvasMediaKind;
  url: string;
  name: string;
  origin: CanvasReferenceOrigin;
  nodeId?: string;
  assetId?: string;
  pending?: boolean;
  error?: string;
};

export type CanvasReuseDraft = {
  sourceNodeId?: string;
  kind: CanvasMediaKind;
  prompt: string;
  params: CanvasGenerationParams;
  references: CanvasReferenceDraft[];
  operation: "generate" | "edit" | "extend";
  variantRequirementsText?: string;
  dirty: boolean;
};

export type ReferenceDraftResult = {
  references: CanvasReferenceDraft[];
  added: CanvasReferenceDraft[];
  rejected: CanvasReferenceDraft[];
};

export function referenceDraftKey(reference: Pick<CanvasReferenceDraft, "kind" | "url">) {
  return `${reference.kind}:${reference.url.trim()}`;
}

export function dedupeReferenceDrafts(
  references: CanvasReferenceDraft[],
  limit = CANVAS_MAX_REFERENCES,
) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = referenceDraftKey(reference);
    if (!reference.url.trim() || seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

export function addReferenceDrafts(
  current: CanvasReferenceDraft[],
  incoming: CanvasReferenceDraft[],
  limit = CANVAS_MAX_REFERENCES,
): ReferenceDraftResult {
  const existing = new Set(current.map(referenceDraftKey));
  const added: CanvasReferenceDraft[] = [];
  const rejected: CanvasReferenceDraft[] = [];
  const next = [...current];
  for (const reference of incoming) {
    const key = referenceDraftKey(reference);
    if (!reference.url.trim() || existing.has(key) || next.length >= limit) {
      rejected.push(reference);
      continue;
    }
    existing.add(key);
    next.push(reference);
    added.push(reference);
  }
  return { references: next, added, rejected };
}

export function removeReferenceDraft(
  references: CanvasReferenceDraft[],
  id: string,
) {
  return references.filter((reference) => reference.id !== id);
}

export function reorderReferenceDrafts(
  references: CanvasReferenceDraft[],
  from: number,
  to: number,
) {
  if (from < 0 || to < 0 || from >= references.length || to >= references.length || from === to)
    return references;
  const next = [...references];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function cloneReuseDraft(draft: CanvasReuseDraft): CanvasReuseDraft {
  return {
    ...draft,
    params: { ...draft.params } as CanvasGenerationParams,
    references: draft.references.map((reference) => ({ ...reference })),
  };
}

export function reuseDraftFromNode(
  node: CanvasNode,
  references: CanvasReferenceDraft[],
): CanvasReuseDraft | null {
  if (node.type !== "media" || !node.data.kind) return null;
  const params = node.data.generation?.params || node.data.params;
  if (!params) return null;
  return {
    sourceNodeId: node.id,
    kind: node.data.kind,
    prompt: String(node.data.generation?.prompt || node.data.prompt || ""),
    params: { ...params } as CanvasGenerationParams,
    references: dedupeReferenceDrafts(references),
    operation: node.data.kind === "video" && "operation" in params && params.operation === "extend"
      ? "extend"
      : "generate",
    dirty: false,
  };
}

export function referenceIdsForDraft(references: CanvasReferenceDraft[]) {
  return references
    .map((reference) => reference.nodeId)
    .filter((id): id is string => Boolean(id));
}

import type { EditorRequestState } from "./editor-request";

type EditorTaskReference = {
  id: string;
  kind: "image";
  name: string;
  dataUrl: string;
};

export type EditorMaskProjection = {
  dataUrl: string;
  annotations: readonly unknown[];
  feather: number;
  sourceImageDataUrl?: string;
  moveSourceMaskDataUrl?: string;
};

export type EditorTaskDraft = {
  id: string;
  sourceImageId: string;
  status: "pending";
  mode: "edit" | "upscale";
  prompt: string;
  expectedCount: number;
  startedAt: number;
  info: string;
  items: readonly [];
  itemIds: readonly [];
  request: Record<string, unknown>;
};

export type EditorTaskSource = {
  id: string;
  url: string;
  prompt: string;
  outputSize?: string | null;
};

export type StoredEditorTask = {
  id?: string;
  sourceImageId?: string;
  mode?: string;
  prompt?: string;
  request?: Record<string, unknown>;
  providerPossiblyAccepted?: boolean;
  providerResultWithheld?: boolean;
  resultRecoveryRequired?: boolean;
};

export type EditorTaskAction = "recover-result" | "check-record" | "retry";

export function editorTaskAction(task: StoredEditorTask): EditorTaskAction {
  if (task.resultRecoveryRequired) return "recover-result";
  if (task.providerPossiblyAccepted) return "check-record";
  return "retry";
}

export type EditorTaskGallerySource = EditorTaskSource & { favorite?: boolean };
export type EditorTaskReferenceSource = { id?: unknown; name?: unknown; url?: unknown; dataUrl?: unknown };

function editorReference(editor: EditorRequestState): EditorTaskReference {
  return {
    id: editor.item.id,
    kind: "image",
    name: `上一版-${editor.item.id.slice(-6)}`,
    dataUrl: editor.item.url,
  };
}

export function editorMaskProjection(editor: EditorRequestState): EditorMaskProjection | null {
  if (!editor.mask) return null;
  const feather = Math.max(0, Math.min(48, Math.round(Number(editor.feather) || 0)));
  return {
    dataUrl: editor.mask,
    annotations: editor.annotations || [],
    feather,
    ...(editor.sourceImageDataUrl ? { sourceImageDataUrl: editor.sourceImageDataUrl } : {}),
    ...(editor.moveSourceMaskDataUrl ? { moveSourceMaskDataUrl: editor.moveSourceMaskDataUrl } : {}),
  };
}

/** Projects the page-owned editor state into the existing task storage shape. */
export function buildEditorTaskDraft(
  editor: EditorRequestState,
  taskId: string,
  startedAt: number,
): EditorTaskDraft {
  const reference = editorReference(editor);
  const isUpscale = editor.mode === "upscale";
  const prompt = isUpscale ? editor.item.prompt || "Upscale this image" : editor.prompt.trim();

  return {
    id: taskId,
    sourceImageId: editor.item.id,
    status: "pending",
    mode: editor.mode,
    prompt,
    expectedCount: isUpscale ? 1 : Math.max(1, Math.min(8, Math.round(Number(editor.count) || 1))),
    startedAt,
    info: `${isUpscale ? "图片超分" : "图片修改"} · 后台处理中`,
    items: [],
    itemIds: [],
    request: isUpscale
      ? {
          sourceImageId: editor.item.id,
          upscaleScale: editor.scale,
          upscaleOutputFormat: editor.upscaleOutputFormat,
          upscaleOutputQuality: editor.upscaleOutputQuality,
          modelId: editor.modelId,
          references: [reference],
        }
      : {
          imageOperation: "edit",
          modelId: editor.modelId,
          ratio: editor.ratio,
          count: editor.count,
          quality: editor.quality,
          fidelity: editor.fidelity,
          sizeMode: editor.sizeMode,
          sizeTier: editor.sizeTier,
          customWidth: editor.customWidth,
          customHeight: editor.customHeight,
          outputFormat: "png",
          backgroundMode: "auto",
          references: [reference],
          mask: editorMaskProjection(editor)
            ? { ...editorMaskProjection(editor)!, referenceId: editor.item.id }
            : null,
        },
  };
}

export function isEditorImageTask(task: StoredEditorTask): boolean {
  const request = task.request;
  return task.mode === "edit" && Boolean(request) && (
    request?.imageOperation === "edit" ||
    ((request?.fidelity === "high" || request?.fidelity === "low") && !("backgroundMode" in (request || {})))
  );
}

export function findEditorTaskSource(
  task: StoredEditorTask,
  gallery: readonly EditorTaskGallerySource[],
  logReferences: readonly EditorTaskReferenceSource[] = [],
): EditorTaskSource | null {
  const request = task.request || {};
  const mask = request.mask && typeof request.mask === "object" ? request.mask as Record<string, unknown> : null;
  const taskReferences = Array.isArray(request.references) ? request.references as EditorTaskReferenceSource[] : [];
  const references = [...taskReferences, ...logReferences];
  const sourceId = [task.sourceImageId, request.sourceImageId, mask?.referenceId, ...references.map((reference) => reference.id)]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const existing = sourceId ? gallery.find((item) => item.id === sourceId) : undefined;
  if (existing?.url) return { id: existing.id, url: existing.url, prompt: existing.prompt, outputSize: existing.outputSize };

  const reference = references.find((item) => (!sourceId || item.id === sourceId) && (typeof item.url === "string" || typeof item.dataUrl === "string"));
  const url = typeof reference?.url === "string" ? reference.url : typeof reference?.dataUrl === "string" ? reference.dataUrl : "";
  if (!url) return null;
  return {
    id: sourceId || (typeof reference?.id === "string" ? reference.id : "recovered-source"),
    url,
    prompt: task.prompt || "",
  };
}

export function restoreEditorTaskState(
  task: StoredEditorTask,
  source: EditorTaskSource,
  supportedModelIds: readonly string[],
): EditorRequestState | null {
  if (task.mode !== "edit" || !task.request) return null;

  const request = task.request;
  const rawMask = request.mask;
  const mask = rawMask && typeof rawMask === "object" ? rawMask as Record<string, unknown> : null;
  const rawModelId = typeof request.modelId === "string" ? request.modelId : "auto";
  const customWidth = Number(request.customWidth);
  const customHeight = Number(request.customHeight);
  const count = Number(request.count);
  const feather = Number(mask?.feather);
  const annotations = Array.isArray(mask?.annotations) ? mask.annotations : [];

  return {
    mode: "edit",
    item: source,
    prompt: String(task.prompt || ""),
    modelId: rawModelId === "auto" || supportedModelIds.includes(rawModelId) ? rawModelId : "auto",
    ratio: typeof request.ratio === "string" ? request.ratio : "1:1",
    count: Number.isFinite(count) ? Math.max(1, Math.min(8, Math.round(count))) : 1,
    quality: typeof request.quality === "string" ? request.quality : "自动",
    fidelity: request.fidelity === "low" ? "low" : "high",
    sizeMode: request.sizeMode === "custom" ? "custom" : "system",
    sizeTier: typeof request.sizeTier === "string" ? request.sizeTier : "1k",
    customWidth: Number.isFinite(customWidth) && customWidth > 0 ? Math.round(customWidth) : 1024,
    customHeight: Number.isFinite(customHeight) && customHeight > 0 ? Math.round(customHeight) : 1024,
    mask: typeof mask?.dataUrl === "string" ? mask.dataUrl : null,
    annotations,
    feather: Number.isFinite(feather) ? Math.max(0, Math.min(48, Math.round(feather))) : 0,
    ...(typeof mask?.sourceImageDataUrl === "string" ? { sourceImageDataUrl: mask.sourceImageDataUrl } : {}),
    ...(typeof mask?.moveSourceMaskDataUrl === "string" ? { moveSourceMaskDataUrl: mask.moveSourceMaskDataUrl } : {}),
    scale: 2,
    targetSize: "auto",
    seed: 42,
    colorCorrection: "wavelet",
    algorithm: "lanczos",
    upscaleOutputFormat: "png",
    upscaleOutputQuality: 95,
  };
}

export function editorTaskGalleryItemId(taskId: string, index: number) {
  const safeTaskId = taskId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  return `edit-${safeTaskId}-${Math.max(0, Math.floor(index))}`;
}


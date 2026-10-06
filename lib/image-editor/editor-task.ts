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
};

export type EditorTaskDraft = {
  id: string;
  status: "pending";
  mode: "edit" | "upscale";
  prompt: string;
  expectedCount: 1;
  startedAt: number;
  info: string;
  items: readonly [];
  itemIds: readonly [];
  request: Record<string, unknown>;
};

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
    status: "pending",
    mode: editor.mode,
    prompt,
    expectedCount: 1,
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
          modelId: editor.modelId,
          ratio: editor.ratio,
          count: editor.count,
          quality: editor.quality,
          fidelity: editor.fidelity,
          sizeMode: editor.sizeMode,
          sizeTier: editor.sizeTier,
          customWidth: editor.customWidth,
          customHeight: editor.customHeight,
          references: [reference],
          mask: editorMaskProjection(editor)
            ? { ...editorMaskProjection(editor)!, referenceId: editor.item.id }
            : null,
        },
  };
}


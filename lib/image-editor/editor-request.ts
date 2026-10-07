import { editorRatio, presetDimensions } from "@/lib/generation-log-presentation";
import { isCloudUpscaleModel } from "@/lib/image-editor/editor-options";
import { upscaleTargetDimensions } from "@/lib/canvas/upscale";

type EditorItem = { id: string; url: string; prompt: string; outputSize?: string | null };
type EditorModel = { id: string; provider?: string; outputFormats?: readonly string[] };

export type EditorRequestState = {
  mode: "edit" | "upscale";
  item: EditorItem;
  prompt: string;
  modelId: string;
  ratio: string;
  count: number;
  quality: string;
  fidelity: "high" | "low";
  sizeMode: "system" | "custom";
  sizeTier: string;
  customWidth: number;
  customHeight: number;
  mask: string | null;
  sourceImageDataUrl?: string;
  annotations?: readonly unknown[];
  feather?: number;
  scale: number;
  targetSize: "auto" | "1K" | "2K" | "4K";
  seed: number;
  colorCorrection: string;
  algorithm: string;
  upscaleOutputFormat: string;
  upscaleOutputQuality: number;
};

export type EditorRequestResult = {
  endpoint: "/api/edit" | "/api/upscale";
  body: Record<string, unknown>;
  editorReference: { id: string; name: string; url: string };
  ratio: string;
  cloudUpscale: boolean;
  cloudOutputFormat?: string;
};

export function buildEditorRequest(
  editor: EditorRequestState,
  taskId: string,
  sourceSize: { width: number; height: number } | null,
  upscaleModel: EditorModel | null | undefined,
): EditorRequestResult {
  const editorReference = {
    id: editor.item.id,
    name: `上一版-${editor.item.id.slice(-6)}`,
    url: editor.item.url,
  };
  const ratio = editorRatio(editor);
  const cloudUpscale = editor.mode === "upscale" && isCloudUpscaleModel(upscaleModel);
  const cloudOutputFormat = cloudUpscale && upscaleModel?.outputFormats?.includes(editor.upscaleOutputFormat)
    ? editor.upscaleOutputFormat
    : undefined;

  if (editor.mode === "upscale") {
    const targetSize = sourceSize
      ? upscaleTargetDimensions(sourceSize, editor.scale, upscaleModel, editor.targetSize)
      : null;
    const upscaleSize = targetSize ? `${targetSize.width}x${targetSize.height}` : "";
    return {
      endpoint: "/api/upscale",
      editorReference,
      ratio,
      cloudUpscale,
      cloudOutputFormat,
      body: {
        taskId,
        sourceImageId: editor.item.id,
        model: editor.modelId,
        reference: editor.item.url,
        referenceImages: [editorReference],
        scale: editor.scale,
        ...(cloudUpscale
          ? {
              ...(cloudOutputFormat ? { outputFormat: cloudOutputFormat } : {}),
              ...(cloudOutputFormat === "jpg" ? { outputQuality: editor.upscaleOutputQuality } : {}),
            }
          : {
              size: upscaleSize,
              seed: editor.seed,
              colorCorrection: editor.colorCorrection,
              resizeMethod: editor.algorithm,
            }),
        prompt: editor.prompt,
      },
    };
  }

  const dimensions = editor.sizeMode === "custom"
    ? { width: editor.customWidth, height: editor.customHeight }
    : presetDimensions(ratio, editor.sizeTier);
  return {
    endpoint: "/api/edit",
    editorReference,
    ratio,
    cloudUpscale: false,
    body: {
      taskId,
      prompt: editor.prompt.trim(),
      model: editor.modelId,
      aspectRatio: ratio,
      sizeMode: editor.sizeMode,
      count: editor.count,
      width: dimensions.width,
      height: dimensions.height,
      resolution: editor.sizeMode === "custom" ? undefined : editor.sizeTier.toUpperCase(),
      quality: editor.quality,
      fidelity: editor.fidelity,
      references: [editorReference.url],
      referenceImages: [editorReference],
      mask: editor.mask || undefined,
      moveGuide: editor.sourceImageDataUrl || undefined,
    },
  };
}


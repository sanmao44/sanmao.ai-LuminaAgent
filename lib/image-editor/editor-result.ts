import type { EditorRequestState } from "./editor-request";
import { editorMaskProjection } from "./editor-task";

type EditorReference = { id: string; name: string; url: string };
type KnownModel = { id: string; providerId?: string; provider?: string };

export type EditorTaskResponse = {
  taskId?: string;
  model?: { id?: string; name?: string; provider?: string };
};

export type EditorImageResult = { url: string; revisedPrompt?: string };

export function requireEditorImages(value: unknown): EditorImageResult[] {
  if (!Array.isArray(value)) throw new Error("图片服务没有返回可应用的结果，本轮任务未完成。");
  const images = value.flatMap((image): EditorImageResult[] => {
    if (!image || typeof image !== "object" || !("url" in image) || typeof image.url !== "string" || !image.url.trim()) return [];
    return [{
      url: image.url,
      ...( "revisedPrompt" in image && typeof image.revisedPrompt === "string" ? { revisedPrompt: image.revisedPrompt } : {}),
    }];
  });
  if (!images.length) throw new Error("图片服务没有返回可应用的结果，本轮任务未完成。");
  return images;
}

export function buildEditorModelCallInput(
  editor: EditorRequestState,
  response: EditorTaskResponse,
  knownModels: readonly KnownModel[],
  cloudUpscale: boolean,
  cloudOutputFormat: string | undefined,
) {
  const manualModel = editor.modelId !== "auto"
    ? knownModels.find((model) => model.id === editor.modelId)
    : undefined;
  const actualModel = response.model?.id
    ? knownModels.find((model) => model.id === response.model?.id)
    : undefined;

  return {
    context: editor.mode === "upscale" ? "upscale" : "edit",
    mode: manualModel ? "manual" : "auto",
    providerId: (manualModel || actualModel)?.providerId,
    modelId: (manualModel || actualModel)?.id,
    params: editor.mode === "upscale"
      ? {
          upscaleScale: editor.scale,
          ...(cloudUpscale
            ? {
                upscaleOutputFormat: cloudOutputFormat,
                upscaleOutputQuality: cloudOutputFormat === "jpg" ? editor.upscaleOutputQuality : undefined,
              }
            : {
                upscaleTarget: editor.targetSize,
                upscaleSeed: editor.seed,
                upscaleColorCorrection: editor.colorCorrection,
                upscaleAlgorithm: editor.algorithm,
              }),
        }
      : {
          ratio: editor.ratio,
          count: editor.count,
          quality: editor.quality,
          fidelity: editor.fidelity,
          sizeMode: editor.sizeMode,
          sizeTier: editor.sizeTier,
          customWidth: editor.customWidth,
          customHeight: editor.customHeight,
        },
  };
}

export function buildEditorHistoryMeta(
  editor: EditorRequestState,
  response: EditorTaskResponse,
  durationMs: number,
  reference: EditorReference,
  cloudOutputFormat: string | undefined,
  taskId?: string,
) {
  const isUpscale = editor.mode === "upscale";
  const mask = !isUpscale ? editorMaskProjection(editor) : null;
  return {
    prompt: isUpscale ? editor.item.prompt : editor.prompt,
    modelId: response.model?.id,
    modelName: response.model?.name,
    providerName: response.model?.provider,
    aspectRatio: editor.ratio,
    outputSize: isUpscale ? `${editor.scale}× 超分` : undefined,
    outputFormat: isUpscale && cloudOutputFormat
      ? cloudOutputFormat === "jpg" ? "jpeg" : cloudOutputFormat
      : isUpscale ? "png" : undefined,
    source: isUpscale ? "upscale" : "edit",
    parentId: editor.item.id,
    ...(taskId ? { taskId } : {}),
    sourceImageId: isUpscale ? editor.item.id : undefined,
    upscaleProvider: isUpscale ? response.model?.provider : undefined,
    upscaleModel: isUpscale ? response.model?.id : undefined,
    upscaleScale: isUpscale ? editor.scale : undefined,
    upscaleTaskId: isUpscale ? response.taskId : undefined,
    generationMs: durationMs,
    references: [reference],
    annotations: !isUpscale && Array.isArray(editor.annotations) ? editor.annotations : undefined,
    ...(mask ? { mask } : {}),
  };
}

export function editorCompletionInfo(
  editor: EditorRequestState,
  response: EditorTaskResponse,
  durationMs: number,
  itemCount: number,
) {
  return `${editor.mode === "upscale" ? "图片超分" : "图片修改"} · ${response.model?.name || "图片模型"} · ${(durationMs / 1000).toFixed(1)}s · ${itemCount} 张`;
}


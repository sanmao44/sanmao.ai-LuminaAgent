import type { GalleryItem, GalleryLocalEditMask, GallerySource } from '../client-history';
import type { ReferenceImageRecord, UpscaleOutputFormat } from '../types';
import type { LocalEditAnnotation } from '../local-edit';
import type { ProvenanceEdge, ProvenanceEdgeDraft } from '../provenance/types';

export type GalleryImageInput = {
  url: string;
  localFileName?: string;
  revisedPrompt?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
};

export type GalleryRecordMeta = {
  prompt: string;
  presetId?: string;
  presetName?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  aspectRatio?: string;
  outputSize?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp' | 'bmp';
  generationMs?: number;
  references?: ReferenceImageRecord[];
  compareReference?: ReferenceImageRecord;
  parentId?: string;
  source?: GallerySource;
  sourceImageId?: string;
  projectId?: string;
  chatId?: string;
  taskId?: string;
  upscaleProvider?: string;
  upscaleModel?: string;
  upscaleScale?: 1 | 2 | 3 | 4;
  upscaleTaskId?: string;
  upscaleOutputFormat?: UpscaleOutputFormat;
  upscaleOutputQuality?: number;
  angle?: GalleryItem['angle'];
  annotations?: LocalEditAnnotation[];
  mask?: GalleryLocalEditMask;
  provenance?: ProvenanceEdgeDraft[];
};

export type GalleryItemProjectionOptions = {
  createdAt: number;
  createId: (image: GalleryImageInput, index: number, createdAt: number) => string;
  fallbackSource?: GallerySource;
  preserveEmptyReferences?: boolean;
  preserveEmptyAnnotations?: boolean;
  includeCompareReference?: boolean;
  includeProvenance?: boolean;
};

/** Build persisted gallery records without performing storage or UI side effects. */
export function buildGalleryItems(
  images: readonly GalleryImageInput[],
  meta: GalleryRecordMeta,
  options: GalleryItemProjectionOptions,
): GalleryItem[] {
  const references = meta.references?.length
    ? meta.references
    : meta.compareReference
      ? [meta.compareReference]
      : options.preserveEmptyReferences
        ? meta.references
        : undefined;

  return images.map((image, index) => {
    const id = options.createId(image, index, options.createdAt);
    const provenance: ProvenanceEdge[] | undefined = options.includeProvenance
      ? meta.provenance?.map((edge) => ({
          ...edge,
          id: `provenance:${edge.relation}:${edge.fromId}:${id}`,
          toId: id,
        }))
      : undefined;

    return {
      id,
      url: image.url,
      localFileName: image.localFileName,
      prompt: image.localFileName || meta.prompt,
      presetId: meta.presetId,
      presetName: meta.presetName,
      revisedPrompt: image.revisedPrompt,
      modelId: image.modelId || meta.modelId,
      modelName: image.modelName || meta.modelName,
      providerName: image.providerName || meta.providerName,
      aspectRatio: meta.aspectRatio,
      outputSize: meta.outputSize,
      outputFormat: meta.outputFormat,
      generationMs: meta.generationMs,
      source: meta.source || options.fallbackSource || (references?.length ? 'edit' : 'generate'),
      createdAt: options.createdAt + index,
      favorite: false,
      parentId: meta.parentId,
      sourceImageId: meta.sourceImageId,
      projectId: meta.projectId,
      chatId: meta.chatId,
      taskId: meta.taskId,
      upscaleProvider: meta.upscaleProvider,
      upscaleModel: meta.upscaleModel,
      upscaleScale: meta.upscaleScale,
      upscaleTaskId: meta.upscaleTaskId,
      upscaleOutputFormat: meta.upscaleOutputFormat,
      upscaleOutputQuality: meta.upscaleOutputQuality,
      references,
      ...(options.includeCompareReference
        ? {
            compareReferenceUrl: references?.[0]?.url || meta.compareReference?.url,
            compareReferenceName: references?.[0]?.name || meta.compareReference?.name,
          }
        : {}),
      angle: meta.angle,
      ...(options.preserveEmptyAnnotations || meta.annotations?.length
        ? { annotations: meta.annotations }
        : {}),
      ...(meta.mask ? { mask: meta.mask } : {}),
      ...(provenance?.length ? { provenance } : {}),
    };
  });
}

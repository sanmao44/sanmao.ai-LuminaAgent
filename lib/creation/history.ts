'use client';

import { saveGalleryItems, type GalleryItem, type GalleryLocalEditMask, type GallerySource } from '../client-history';
import type { ReferenceImageRecord, UpscaleOutputFormat } from '../types';
import type { LocalEditAnnotation } from '../local-edit';
import type { ProvenanceEdge, ProvenanceEdgeDraft } from '../provenance/types';

export async function recordCanvasImages(
  images: Array<{ url: string; revisedPrompt?: string }>,
  meta: {
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
    annotations?: LocalEditAnnotation[];
    mask?: GalleryLocalEditMask;
    provenance?: ProvenanceEdgeDraft[];
  },
) {
  const createdAt = Date.now();
  const items: GalleryItem[] = images.map((image, index) => {
    const id = `canvas-image-${createdAt.toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    const provenance: ProvenanceEdge[] | undefined = meta.provenance?.map((edge) => ({
      ...edge,
      id: `provenance:${edge.relation}:${edge.fromId}:${id}`,
      toId: id,
    }));
    return {
    id,
    url: image.url,
    revisedPrompt: image.revisedPrompt,
    prompt: meta.prompt,
    presetId: meta.presetId,
    presetName: meta.presetName,
    modelId: meta.modelId,
    modelName: meta.modelName,
    providerName: meta.providerName,
    aspectRatio: meta.aspectRatio,
    outputSize: meta.outputSize,
    outputFormat: meta.outputFormat,
    generationMs: meta.generationMs,
    source: meta.source || (meta.references?.length ? 'edit' : 'generate'),
    createdAt: createdAt + index,
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
    references: meta.references,
    annotations: meta.annotations,
    mask: meta.mask,
    ...(provenance?.length ? { provenance } : {}),
    };
  });
  await saveGalleryItems(items);
  return items;
}

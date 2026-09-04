'use client';

import { saveGalleryItems, type GalleryItem, type GalleryLocalEditMask, type GallerySource } from '../client-history';
import type { ReferenceImageRecord, UpscaleOutputFormat } from '../types';
import type { LocalEditAnnotation } from '../local-edit';

export async function recordCanvasImages(
  images: Array<{ url: string; revisedPrompt?: string }>,
  meta: {
    prompt: string;
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
    upscaleProvider?: string;
    upscaleModel?: string;
    upscaleScale?: 1 | 2 | 3 | 4;
    upscaleTaskId?: string;
    upscaleOutputFormat?: UpscaleOutputFormat;
    upscaleOutputQuality?: number;
    annotations?: LocalEditAnnotation[];
    mask?: GalleryLocalEditMask;
  },
) {
  const createdAt = Date.now();
  const items: GalleryItem[] = images.map((image, index) => ({
    id: `canvas-image-${createdAt.toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    url: image.url,
    revisedPrompt: image.revisedPrompt,
    prompt: meta.prompt,
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
    upscaleProvider: meta.upscaleProvider,
    upscaleModel: meta.upscaleModel,
    upscaleScale: meta.upscaleScale,
    upscaleTaskId: meta.upscaleTaskId,
    upscaleOutputFormat: meta.upscaleOutputFormat,
    upscaleOutputQuality: meta.upscaleOutputQuality,
    references: meta.references,
    annotations: meta.annotations,
    mask: meta.mask,
  }));
  await saveGalleryItems(items);
  return items;
}

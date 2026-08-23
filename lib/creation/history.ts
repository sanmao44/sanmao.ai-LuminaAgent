'use client';

import { saveGalleryItems, type GalleryItem } from '../client-history';
import type { ReferenceImageRecord } from '../types';

export async function recordCanvasImages(
  images: Array<{ url: string; revisedPrompt?: string }>,
  meta: {
    prompt: string;
    modelId?: string;
    modelName?: string;
    providerName?: string;
    aspectRatio?: string;
    outputSize?: string;
    outputFormat?: 'png' | 'jpeg' | 'webp';
    generationMs?: number;
    references?: ReferenceImageRecord[];
    parentId?: string;
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
    source: meta.references?.length ? 'edit' : 'generate',
    createdAt: createdAt + index,
    favorite: false,
    parentId: meta.parentId,
    references: meta.references,
  }));
  await saveGalleryItems(items);
  return items;
}

'use client';

import { buildGalleryItems, type GalleryImageInput, type GalleryRecordMeta } from './gallery-items';
import { assetRepository } from '../repositories/asset-repository';

export async function recordCanvasImages(
  images: GalleryImageInput[],
  meta: GalleryRecordMeta,
) {
  const createdAt = Date.now();
  const items = buildGalleryItems(images, meta, {
    createdAt,
    createId: (_image, index, timestamp) => `canvas-image-${timestamp.toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    preserveEmptyReferences: true,
    preserveEmptyAnnotations: true,
    includeProvenance: true,
  });
  await assetRepository.saveGallery(items);
  return items;
}

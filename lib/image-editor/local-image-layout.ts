import {
  cropRectForRatio,
  imageSizeForRatio,
  type ImageRect,
  type ImageSize,
} from '@/lib/canvas/image-operations';

export const LOCAL_IMAGE_ORIGINAL = '原图';
export const LOCAL_IMAGE_FREE = '自由';

function ratioValue(ratio: string) {
  if (ratio === LOCAL_IMAGE_ORIGINAL || ratio === LOCAL_IMAGE_FREE) return null;
  const [width, height] = ratio.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

export function cropSourceRect(width: number, height: number, ratio: string): ImageRect {
  const value = ratioValue(ratio);
  return value === null ? { x: 0, y: 0, width, height } : cropRectForRatio({ width, height }, value);
}

export function canvasRectForRatio(width: number, height: number, ratio: string): ImageSize {
  const value = ratioValue(ratio);
  return value === null ? { width, height } : imageSizeForRatio({ width, height }, value);
}

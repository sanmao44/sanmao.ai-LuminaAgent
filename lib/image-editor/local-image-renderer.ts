import { canvasRectForRatio, cropSourceRect, LOCAL_IMAGE_ORIGINAL } from './local-image-layout';
import type { ImageRect } from '@/lib/canvas/image-operations';

export type LocalImageRenderMode = 'crop' | 'canvas';
export type LocalImageBackground = 'transparent' | 'white' | 'black' | 'blur';

export type LocalImageRenderResult = { dataUrl: string; width: number; height: number };

function drawCoverImage(context: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.ceil(sourceWidth * scale);
  const height = Math.ceil(sourceHeight * scale);
  context.drawImage(image, (targetWidth - width) / 2, (targetHeight - height) / 2, width, height);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const source = new Image();
  if (/^https?:/i.test(url)) source.crossOrigin = 'anonymous';
  return new Promise((resolve, reject) => {
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error('无法读取这张图片，可能是远程图片未开放浏览器处理权限'));
    source.src = url;
  });
}

export async function renderLocalImage(url: string, mode: LocalImageRenderMode, ratio: string, background: LocalImageBackground, flipX: boolean, rotation: number, selectedCrop?: ImageRect): Promise<LocalImageRenderResult> {
  const source = await loadImage(url);
  const rawCrop = mode === 'crop' && selectedCrop ? selectedCrop : mode === 'crop' ? cropSourceRect(source.naturalWidth, source.naturalHeight, ratio) : { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight };
  const crop = { x: Math.round(rawCrop.x), y: Math.round(rawCrop.y), width: Math.max(1, Math.round(rawCrop.width)), height: Math.max(1, Math.round(rawCrop.height)) };
  const swap = rotation === 90 || rotation === 270;
  const transformed = document.createElement('canvas');
  transformed.width = swap ? crop.height : crop.width;
  transformed.height = swap ? crop.width : crop.height;
  const context = transformed.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持本地图像处理');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(transformed.width / 2, transformed.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.scale(flipX ? -1 : 1, 1);
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, -crop.width / 2, -crop.height / 2, crop.width, crop.height);
  if (mode === 'crop' || ratio === LOCAL_IMAGE_ORIGINAL) return { dataUrl: transformed.toDataURL('image/png'), width: transformed.width, height: transformed.height };

  const target = canvasRectForRatio(transformed.width, transformed.height, ratio);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const output = canvas.getContext('2d');
  if (!output) throw new Error('当前浏览器不支持本地图像处理');
  output.imageSmoothingEnabled = true;
  output.imageSmoothingQuality = 'high';
  if (background === 'white' || background === 'black') {
    output.fillStyle = background === 'white' ? '#ffffff' : '#050507';
    output.fillRect(0, 0, canvas.width, canvas.height);
  } else if (background === 'blur') {
    output.save();
    output.filter = 'blur(26px)';
    drawCoverImage(output, transformed, transformed.width, transformed.height, canvas.width, canvas.height);
    output.restore();
    output.fillStyle = 'rgba(255,255,255,.06)';
    output.fillRect(0, 0, canvas.width, canvas.height);
  }
  output.drawImage(transformed, Math.round((canvas.width - transformed.width) / 2), Math.round((canvas.height - transformed.height) / 2));
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

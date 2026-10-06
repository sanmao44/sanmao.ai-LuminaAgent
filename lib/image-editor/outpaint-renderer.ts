import type { OutpaintLayout } from './outpaint-layout';

export type OutpaintRenderResult = {
  dataUrl: string;
  width: number;
  height: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  const source = new Image();
  if (/^https?:/i.test(url)) source.crossOrigin = 'anonymous';
  return new Promise((resolve, reject) => {
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error('无法读取这张图片，可能是远程图片未开放浏览器处理权限'));
    source.src = url;
  });
}

export async function renderOutpaintWhiteCanvas(url: string, layout: OutpaintLayout): Promise<OutpaintRenderResult> {
  const source = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持本地扩图处理');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, layout.offsetX, layout.offsetY, layout.sourceWidth, layout.sourceHeight);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

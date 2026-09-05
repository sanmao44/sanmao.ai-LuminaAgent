import type { CanvasImageOperation } from './types';

export const CANVAS_IMAGE_OPERATION_MAX_EDGE = 6144;
export const CANVAS_IMAGE_OPERATION_MIN_EDGE = 32;

export type ImageSize = { width: number; height: number };
export type ImageRect = { x: number; y: number; width: number; height: number };
export type OutpaintMargins = { top: number; right: number; bottom: number; left: number };
export type CropAspect = 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | 'free';
export type GridLines = { vertical: number[]; horizontal: number[] };
export type CanvasImageGridFit = 'contain' | 'cover';
export type CanvasImageGridCropPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';
export type CanvasImageGridCropOffset = { x: number; y: number };
export type CanvasImageGridCompositeOptions = {
  columns?: number;
  cellSize?: number;
  gap?: number;
  maxEdge?: number;
  background?: string;
  fit?: CanvasImageGridFit;
  cropPosition?: CanvasImageGridCropPosition;
  /** Per-image normalized crop window offsets. 0 is left/top, 1 is right/bottom. */
  cropOffsets?: Array<CanvasImageGridCropOffset | null | undefined>;
};
export type CanvasImageGridCompositeLayout = {
  columns: number;
  rows: number;
  cellSize: number;
  gap: number;
  scale: number;
  width: number;
  height: number;
  background: string;
  fit: CanvasImageGridFit;
  cropPosition: CanvasImageGridCropPosition;
  cropOffsets: CanvasImageGridCropOffset[];
};

export type CanvasImageRenderRequest =
  | { operation: 'outpaint'; margins: OutpaintMargins }
  | { operation: 'resize'; width: number; height: number }
  | { operation: 'crop'; rect: ImageRect }
  | { operation: 'transform'; rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean };

const ASPECTS: Record<Exclude<CropAspect, 'original' | 'free'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

function finitePositive(value: unknown, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const GRID_CROP_POSITIONS: CanvasImageGridCropPosition[] = [
  'top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right',
];

const CROP_POSITION_OFFSETS: Record<CanvasImageGridCropPosition, CanvasImageGridCropOffset> = {
  'top-left': { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

function clampCropOffset(value: CanvasImageGridCropOffset | null | undefined, fallback: CanvasImageGridCropOffset) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return {
    x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback.x,
    y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : fallback.y,
  };
}

export function normalizeImageSize(size: ImageSize): ImageSize {
  return {
    width: Math.max(1, Math.round(finitePositive(size.width))),
    height: Math.max(1, Math.round(finitePositive(size.height))),
  };
}

export function cropAspectRatio(aspect: CropAspect, source: ImageSize) {
  if (aspect === 'original' || aspect === 'free') return source.width / source.height;
  return ASPECTS[aspect];
}

export function cropRectForAspect(sourceValue: ImageSize, aspect: CropAspect): ImageRect {
  const source = normalizeImageSize(sourceValue);
  if (aspect === 'original') return { x: 0, y: 0, width: source.width, height: source.height };
  const ratio = cropAspectRatio(aspect, source);
  if (!Number.isFinite(ratio) || ratio <= 0) return { x: 0, y: 0, width: source.width, height: source.height };
  if (source.width / source.height > ratio) {
    const width = Math.max(1, Math.min(source.width, Math.round(source.height * ratio)));
    return { x: Math.floor((source.width - width) / 2), y: 0, width, height: source.height };
  }
  const height = Math.max(1, Math.min(source.height, Math.round(source.width / ratio)));
  return { x: 0, y: Math.floor((source.height - height) / 2), width: source.width, height };
}

export function clampImageRect(rect: ImageRect, sourceValue: ImageSize, aspect: CropAspect = 'free') {
  const source = normalizeImageSize(sourceValue);
  const min = Math.min(CANVAS_IMAGE_OPERATION_MIN_EDGE, source.width, source.height);
  let width = Math.max(min, Math.min(source.width, finitePositive(rect.width, min)));
  let height = Math.max(min, Math.min(source.height, finitePositive(rect.height, min)));
  if (aspect !== 'free') {
    const ratio = cropAspectRatio(aspect, source);
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
    width = Math.min(source.width, Math.max(min, width));
    height = Math.min(source.height, Math.max(min, height));
  }
  const x = Math.max(0, Math.min(source.width - width, finitePositive(rect.x, 0)));
  const y = Math.max(0, Math.min(source.height - height, finitePositive(rect.y, 0)));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(min, Math.round(width)),
    height: Math.max(min, Math.round(height)),
  } satisfies ImageRect;
}

export function moveImageRect(rect: ImageRect, dx: number, dy: number, source: ImageSize) {
  const current = clampImageRect(rect, source);
  return clampImageRect({ ...current, x: current.x + Number(dx || 0), y: current.y + Number(dy || 0) }, source);
}

function resizeAspectFromHorizontal(
  rect: ImageRect,
  handle: string,
  delta: number,
  source: ImageSize,
) {
  const ratio = rect.width / Math.max(1, rect.height);
  const fromRight = handle.includes('right');
  const anchorX = fromRight ? rect.x : rect.x + rect.width;
  const direction = fromRight ? 1 : -1;
  let width = rect.width + direction * delta;
  const maxWidth = fromRight ? source.width - anchorX : anchorX;
  width = Math.max(CANVAS_IMAGE_OPERATION_MIN_EDGE, Math.min(maxWidth, width));
  let height = width / Math.max(0.001, ratio);
  if (height > source.height) {
    height = source.height;
    width = height * ratio;
  }
  const centerY = rect.y + rect.height / 2;
  const y = Math.max(0, Math.min(source.height - height, centerY - height / 2));
  const x = fromRight ? anchorX : anchorX - width;
  return clampImageRect({ x, y, width, height }, source);
}

function resizeAspectFromVertical(
  rect: ImageRect,
  handle: string,
  delta: number,
  source: ImageSize,
) {
  const ratio = rect.width / Math.max(1, rect.height);
  const fromBottom = handle.includes('bottom');
  const anchorY = fromBottom ? rect.y : rect.y + rect.height;
  const direction = fromBottom ? 1 : -1;
  let height = rect.height + direction * delta;
  const maxHeight = fromBottom ? source.height - anchorY : anchorY;
  height = Math.max(CANVAS_IMAGE_OPERATION_MIN_EDGE, Math.min(maxHeight, height));
  let width = height * ratio;
  if (width > source.width) {
    width = source.width;
    height = width / Math.max(0.001, ratio);
  }
  const centerX = rect.x + rect.width / 2;
  const x = Math.max(0, Math.min(source.width - width, centerX - width / 2));
  const y = fromBottom ? anchorY : anchorY - height;
  return clampImageRect({ x, y, width, height }, source);
}

export function resizeImageRect(
  rectValue: ImageRect,
  handle: string,
  dx: number,
  dy: number,
  sourceValue: ImageSize,
  aspect: CropAspect = 'free',
) {
  const source = normalizeImageSize(sourceValue);
  const rect = clampImageRect(rectValue, source, aspect);
  if (handle === 'move') return moveImageRect(rect, dx, dy, source);
  if (aspect !== 'free') {
    return Math.abs(dx) >= Math.abs(dy)
      ? resizeAspectFromHorizontal(rect, handle, dx, source)
      : resizeAspectFromVertical(rect, handle, dy, source);
  }
  const min = Math.min(CANVAS_IMAGE_OPERATION_MIN_EDGE, source.width, source.height);
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;
  if (handle.includes('left')) left = Math.max(0, Math.min(right - min, left + dx));
  if (handle.includes('right')) right = Math.min(source.width, Math.max(left + min, right + dx));
  if (handle.includes('top')) top = Math.max(0, Math.min(bottom - min, top + dy));
  if (handle.includes('bottom')) bottom = Math.min(source.height, Math.max(top + min, bottom + dy));
  return clampImageRect({ x: left, y: top, width: right - left, height: bottom - top }, source);
}

export function resizeTargetSize(sourceValue: ImageSize, longEdge: number): ImageSize {
  const source = normalizeImageSize(sourceValue);
  const target = Math.max(1, Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, Math.round(Number(longEdge) || 1)));
  const scale = target / Math.max(source.width, source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function transformImageSize(sourceValue: ImageSize, rotation: 0 | 90 | 180 | 270): ImageSize {
  const source = normalizeImageSize(sourceValue);
  return rotation === 90 || rotation === 270
    ? { width: source.height, height: source.width }
    : source;
}

export function equalGridLines(count: number) {
  const safeCount = Math.max(1, Math.min(8, Math.round(Number(count) || 1)));
  return Array.from({ length: safeCount + 1 }, (_, index) => index / safeCount);
}

export function clampGridLine(value: number, index: number, lines: number[], minGap = 0.03) {
  const previous = lines[index - 1] ?? 0;
  const next = lines[index + 1] ?? 1;
  return Math.max(previous + minGap, Math.min(next - minGap, Number(value) || 0));
}

export function gridRects(sourceValue: ImageSize, lines: GridLines): ImageRect[] {
  const source = normalizeImageSize(sourceValue);
  const vertical = [0, ...lines.vertical.filter((value) => value > 0 && value < 1), 1].sort((a, b) => a - b);
  const horizontal = [0, ...lines.horizontal.filter((value) => value > 0 && value < 1), 1].sort((a, b) => a - b);
  const result: ImageRect[] = [];
  for (let row = 0; row < horizontal.length - 1; row += 1) {
    for (let column = 0; column < vertical.length - 1; column += 1) {
      const x = Math.round(vertical[column] * source.width);
      const y = Math.round(horizontal[row] * source.height);
      const right = Math.round(vertical[column + 1] * source.width);
      const bottom = Math.round(horizontal[row + 1] * source.height);
      result.push({ x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) });
    }
  }
  return result;
}

export function gridCompositeLayout(
  count: number,
  options: CanvasImageGridCompositeOptions = {},
): CanvasImageGridCompositeLayout {
  const safeCount = Math.max(1, Math.round(Number(count) || 1));
  const requestedColumns = Number(options.columns);
  const columns = Number.isFinite(requestedColumns) && requestedColumns > 0
    ? Math.min(safeCount, Math.max(1, Math.min(8, Math.round(requestedColumns))))
    : Math.max(1, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.ceil(safeCount / columns);
  const requestedCellSize = Number(options.cellSize);
  const cellSize = Number.isFinite(requestedCellSize)
    ? Math.max(256, Math.min(2048, Math.round(requestedCellSize)))
    : 1024;
  const requestedGap = Number(options.gap);
  const gap = Number.isFinite(requestedGap)
    ? Math.max(0, Math.min(128, Math.round(requestedGap)))
    : 16;
  const maxEdge = Math.max(
    1,
    Math.min(
      CANVAS_IMAGE_OPERATION_MAX_EDGE,
      Math.round(Number(options.maxEdge) || CANVAS_IMAGE_OPERATION_MAX_EDGE),
    ),
  );
  const rawWidth = columns * cellSize + Math.max(0, columns - 1) * gap;
  const rawHeight = rows * cellSize + Math.max(0, rows - 1) * gap;
  const scale = Math.min(1, maxEdge / rawWidth, maxEdge / rawHeight);
  const background = String(options.background || '#ffffff').trim() || '#ffffff';
  const fit: CanvasImageGridFit = options.fit === 'cover' ? 'cover' : 'contain';
  const cropPosition = GRID_CROP_POSITIONS.includes(options.cropPosition as CanvasImageGridCropPosition)
    ? options.cropPosition as CanvasImageGridCropPosition
    : 'center';
  const defaultCropOffset = CROP_POSITION_OFFSETS[cropPosition];
  const cropOffsets = Array.from({ length: safeCount }, (_, index) =>
    clampCropOffset(options.cropOffsets?.[index], defaultCropOffset),
  );
  return {
    columns,
    rows,
    cellSize,
    gap,
    scale,
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(rawHeight * scale)),
    background,
    fit,
    cropPosition,
    cropOffsets,
  };
}

function coverOffset(
  cellSize: number,
  imageSize: number,
  offset: number,
) {
  const remaining = cellSize - imageSize;
  return remaining * Math.max(0, Math.min(1, Number(offset) || 0));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片内容'));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败')), 'image/png');
  });
}

function prepareCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, Math.round(width)));
  canvas.height = Math.max(1, Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, Math.round(height)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持本地图片处理');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

export async function renderCanvasImageOperation(sourceUrl: string, request: CanvasImageRenderRequest) {
  const image = await loadImage(sourceUrl);
  const source = normalizeImageSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
  if (request.operation === 'outpaint') {
    const margins = {
      top: Math.max(0, Math.round(request.margins.top)),
      right: Math.max(0, Math.round(request.margins.right)),
      bottom: Math.max(0, Math.round(request.margins.bottom)),
      left: Math.max(0, Math.round(request.margins.left)),
    };
    const { canvas, context } = prepareCanvas(source.width + margins.left + margins.right, source.height + margins.top + margins.bottom);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, margins.left, margins.top, source.width, source.height);
    return { blob: await canvasToPng(canvas), size: { width: canvas.width, height: canvas.height } };
  }
  if (request.operation === 'resize') {
    const target = resizeTargetSize(source, Math.max(request.width, request.height));
    const { canvas, context } = prepareCanvas(target.width, target.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { blob: await canvasToPng(canvas), size: { width: canvas.width, height: canvas.height } };
  }
  if (request.operation === 'crop') {
    const rect = clampImageRect(request.rect, source);
    const { canvas, context } = prepareCanvas(rect.width, rect.height);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return { blob: await canvasToPng(canvas), size: { width: canvas.width, height: canvas.height } };
  }
  const rotation = request.rotation;
  const target = transformImageSize(source, rotation);
  const { canvas, context } = prepareCanvas(target.width, target.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(request.flipX ? -1 : 1, request.flipY ? -1 : 1);
  context.drawImage(image, -source.width / 2, -source.height / 2, source.width, source.height);
  context.restore();
  return { blob: await canvasToPng(canvas), size: { width: canvas.width, height: canvas.height } };
}

export async function renderCanvasImageGrid(sourceUrl: string, sourceValue: ImageSize, lines: GridLines) {
  const image = await loadImage(sourceUrl);
  const source = normalizeImageSize(sourceValue);
  const rects = gridRects(source, lines);
  const outputs = [];
  for (const rect of rects) {
    const { canvas, context } = prepareCanvas(rect.width, rect.height);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    outputs.push({ blob: await canvasToPng(canvas), size: { width: canvas.width, height: canvas.height }, rect });
  }
  return outputs;
}

/** Stitch multiple images into a square-ish, non-cropping white grid. */
export async function renderCanvasImageGridComposite(
  sourceUrls: string[],
  options: CanvasImageGridCompositeOptions = {},
) {
  const urls = sourceUrls.map((url) => String(url || '').trim()).filter(Boolean);
  if (!urls.length) throw new Error('至少需要一张图片才能进行宫格拼接');
  const images = await Promise.all(urls.map((url) => loadImage(url)));
  const layout = gridCompositeLayout(images.length, options);
  const { canvas, context } = prepareCanvas(layout.width, layout.height);
  if (layout.background !== 'transparent') {
    context.fillStyle = layout.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  const cellSize = layout.cellSize * layout.scale;
  const gap = layout.gap * layout.scale;
  images.forEach((image, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const cellX = column * (cellSize + gap);
    const cellY = row * (cellSize + gap);
    const imageWidth = image.naturalWidth || image.width || 1;
    const imageHeight = image.naturalHeight || image.height || 1;
    const imageScale = layout.fit === 'cover'
      ? Math.max(cellSize / imageWidth, cellSize / imageHeight)
      : Math.min(cellSize / imageWidth, cellSize / imageHeight);
    const width = imageWidth * imageScale;
    const height = imageHeight * imageScale;
    const cropOffset = layout.cropOffsets[index] || { x: 0.5, y: 0.5 };
    context.save();
    if (layout.fit === 'cover') {
      context.beginPath();
      context.rect(cellX, cellY, cellSize, cellSize);
      context.clip();
    }
    context.drawImage(
      image,
      cellX + coverOffset(cellSize, width, cropOffset.x),
      cellY + coverOffset(cellSize, height, cropOffset.y),
      width,
      height,
    );
    context.restore();
  });

  return {
    blob: await canvasToPng(canvas),
    size: { width: canvas.width, height: canvas.height },
    layout,
  };
}

export function operationLabel(operation: CanvasImageOperation) {
  if (operation === 'grid-compose') return '宫格拼接';
  return operation === 'outpaint' ? '扩图' : operation === 'resize' ? '缩放' : operation === 'crop' ? '裁切' : operation === 'grid' ? '宫格切分' : '镜像-旋转';
}

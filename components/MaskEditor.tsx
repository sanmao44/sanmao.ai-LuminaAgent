'use client';

import { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';
import {
  applyLocalEditAnnotationMask,
  calculateEditableCoverage as calculateLocalEditableCoverage,
  compileLocalEditPrompt,
  featherLocalEditMask,
  moveLocalEditPixels,
  normalizeLocalEditAnnotations,
  type LocalEditAnnotation,
  type LocalEditAnnotationGeometry,
  type LocalEditPoint,
} from '@/lib/local-edit';
import {
  getLocalSegmentationProvider,
  localSegmentationUnavailableMessage,
  segmentLocalSubject,
} from '@/lib/local-segmentation';

export type LocalEditIntent = 'remove' | 'replace' | 'add' | 'subject';

export type LocalEditEditorProps = {
  imageUrl: string;
  initialMaskDataUrl?: string;
  initialPrompt?: string;
  initialAnnotations?: LocalEditAnnotation[];
  onApply: (maskDataUrl: string, coverage: number, prompt: string, annotations: LocalEditAnnotation[], sourceImageDataUrl?: string) => void | Promise<void>;
  onCancel: () => void;
};

/** Kept as a type alias for integrations that still import the old name. */
export type MaskEditorProps = LocalEditEditorProps;

export const LOCAL_EDIT_INTENTS: ReadonlyArray<{ value: LocalEditIntent; label: string; prompt: string }> = [
  { value: 'remove', label: '移除物体', prompt: '移除编辑范围内的物体，并自然补全背景。' },
  { value: 'replace', label: '替换区域', prompt: '将编辑范围替换为：' },
  { value: 'add', label: '添加元素', prompt: '在编辑范围添加：' },
  { value: 'subject', label: '保持主体', prompt: '保持主体、姿态和构图不变，只编辑指定范围。' },
];

type LocalEditTool = 'brush' | 'eraser' | 'rectangle' | 'ellipse' | 'lasso' | 'point' | 'smart' | 'pan';
type PreviewMode = 'overlay' | 'original' | 'range';
type Point = { x: number; y: number };
type HistorySnapshot = {
  image: ImageData;
  mask: ImageData;
  baseMask: ImageData;
  annotations: LocalEditAnnotation[];
  protectedPixels: Uint8Array;
  smartMasks: Array<[string, Uint8ClampedArray]>;
};
type HistoryState = { states: HistorySnapshot[]; index: number };
type Gesture = {
  pointerId: number;
  kind: 'draw' | 'shape' | 'lasso' | 'pan';
  before?: HistorySnapshot;
  start?: Point;
  last?: Point;
  path?: Point[];
  points?: Point[];
  panStart?: Point;
  moved?: boolean;
};

type PendingAnnotation = {
  annotation: LocalEditAnnotation;
  before: HistorySnapshot;
  anchor: Point;
};

type MovingAnnotation = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  initial: LocalEditAnnotation;
  before: HistorySnapshot;
  selectionMask: Uint8ClampedArray;
  initialSmartMask?: Uint8ClampedArray;
};

function samePixels(left: ImageData, right: ImageData) {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) return false;
  for (let index = 0; index < left.data.length; index += 1) {
    if (left.data[index] !== right.data[index]) return false;
  }
  return true;
}

function sameSnapshot(left: HistorySnapshot, right: HistorySnapshot) {
  if (!samePixels(left.image, right.image) || !samePixels(left.mask, right.mask) || !samePixels(left.baseMask, right.baseMask)) return false;
  if (left.protectedPixels.length !== right.protectedPixels.length) return false;
  for (let index = 0; index < left.protectedPixels.length; index += 1) {
    if (left.protectedPixels[index] !== right.protectedPixels[index]) return false;
  }
  if (JSON.stringify(left.annotations) !== JSON.stringify(right.annotations)) return false;
  if (left.smartMasks.length !== right.smartMasks.length) return false;
  for (let index = 0; index < left.smartMasks.length; index += 1) {
    const [leftId, leftPixels] = left.smartMasks[index];
    const [rightId, rightPixels] = right.smartMasks[index];
    if (leftId !== rightId || leftPixels.length !== rightPixels.length) return false;
    for (let pixel = 0; pixel < leftPixels.length; pixel += 1) {
      if (leftPixels[pixel] !== rightPixels[pixel]) return false;
    }
  }
  return true;
}

function formatCoverage(value: number) {
  const percent = value * 100;
  if (percent <= 0) return '0%';
  if (percent < 0.05) return '<0.1%';
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function drawMaskOverlay(mask: HTMLCanvasElement, overlay: HTMLCanvasElement, featherRadius = 0) {
  const maskContext = mask.getContext('2d');
  const overlayContext = overlay.getContext('2d');
  if (!maskContext || !overlayContext) return 0;
  const source = maskContext.getImageData(0, 0, mask.width, mask.height);
  const display = featherRadius > 0
    ? featherLocalEditMask(source.data, mask.width, mask.height, featherRadius)
    : source.data;
  const output = overlayContext.createImageData(mask.width, mask.height);
  for (let index = 0; index < display.length; index += 4) {
    const editable = 255 - display[index + 3];
    output.data[index] = 239;
    output.data[index + 1] = 68;
    output.data[index + 2] = 68;
    output.data[index + 3] = Math.round(Math.min(180, editable * 0.7));
  }
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  overlayContext.putImageData(output, 0, 0);
  // Coverage describes the actual selected pixels, not the softened preview
  // boundary, so changing feather never makes the apply button invalid.
  return calculateLocalEditableCoverage(source.data);
}

function useToolCursor(tool: LocalEditTool) {
  if (tool === 'pan') return 'grab';
  if (tool === 'eraser') return 'cell';
  return 'crosshair';
}

function annotationBounds(annotation: LocalEditAnnotation) {
  const geometry = annotation.geometry;
  if (geometry.kind === 'point') return { x: geometry.x - geometry.radius, y: geometry.y - geometry.radius, width: geometry.radius * 2, height: geometry.radius * 2 };
  if (geometry.kind === 'rectangle' || geometry.kind === 'ellipse' || geometry.kind === 'smart') return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  if (geometry.kind !== 'brush' && geometry.kind !== 'lasso') return { x: 0, y: 0, width: 0.01, height: 0.01 };
  const points: LocalEditPoint[] = geometry.points;
  const xs = points.map((item) => item.x);
  const ys = points.map((item) => item.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(0.01, Math.max(...xs) - minX), height: Math.max(0.01, Math.max(...ys) - minY) };
}

function annotationPreviewBounds(annotation: LocalEditAnnotation) {
  const geometry = annotation.geometry;
  const source = annotationBounds(annotation);
  const padded = geometry.kind === 'brush'
    ? { x: source.x - geometry.radius, y: source.y - geometry.radius, width: source.width + geometry.radius * 2, height: source.height + geometry.radius * 2 }
    : source;
  const x = Math.max(0, Math.min(0.999, padded.x));
  const y = Math.max(0, Math.min(0.999, padded.y));
  const width = Math.max(0.01, Math.min(1 - x, padded.width));
  const height = Math.max(0.01, Math.min(1 - y, padded.height));
  return { x, y, width, height };
}

function annotationPreviewStyle(annotation: LocalEditAnnotation, imageUrl: string): React.CSSProperties {
  const bounds = annotationPreviewBounds(annotation);
  const positionX = bounds.width >= 0.999 ? 50 : (bounds.x / (1 - bounds.width)) * 100;
  const positionY = bounds.height >= 0.999 ? 50 : (bounds.y / (1 - bounds.height)) * 100;
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundPosition: `${positionX}% ${positionY}%`,
    backgroundSize: `${100 / bounds.width}% ${100 / bounds.height}%`,
  };
}

function copyImageData(source: ImageData) {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function createProtectedImageData(width: number, height: number) {
  const image = new ImageData(width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 255;
    image.data[index + 1] = 255;
    image.data[index + 2] = 255;
    image.data[index + 3] = 255;
  }
  return image;
}

function copySmartMasks(masks: ReadonlyMap<string, Uint8ClampedArray>) {
  return Array.from(masks.entries(), ([id, pixels]) => [id, new Uint8ClampedArray(pixels)] as [string, Uint8ClampedArray]);
}

function copyAnnotations(annotations: LocalEditAnnotation[]) {
  return annotations.map((annotation) => {
    const geometry = annotation.geometry;
    return geometry.kind === 'brush' || geometry.kind === 'lasso'
      ? { ...annotation, geometry: { ...geometry, points: geometry.points.map((point) => ({ ...point })) } }
      : { ...annotation, geometry: { ...geometry } };
  }) as LocalEditAnnotation[];
}

function loadMaskPixels(dataUrl: string, width: number, height: number) {
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取智能识别遮罩');
        context.drawImage(image, 0, 0, width, height);
        resolve(new Uint8ClampedArray(context.getImageData(0, 0, width, height).data));
      } catch (cause) {
        reject(cause);
      }
    };
    image.onerror = () => reject(new Error('智能识别遮罩读取失败'));
    image.src = dataUrl;
  });
}

function translateMaskPixels(source: Uint8ClampedArray, width: number, height: number, dx: number, dy: number) {
  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < output.length; index += 4) {
    output[index] = 255;
    output[index + 1] = 255;
    output[index + 2] = 255;
    output[index + 3] = 255;
  }
  const offsetX = Math.round(dx);
  const offsetY = Math.round(dy);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = (targetY * width + targetX) * 4;
      output[targetIndex] = source[sourceIndex];
      output[targetIndex + 1] = source[sourceIndex + 1];
      output[targetIndex + 2] = source[sourceIndex + 2];
      output[targetIndex + 3] = source[sourceIndex + 3];
    }
  }
  return output;
}

function maskPixelsToDataUrl(pixels: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法保存智能识别遮罩');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

function annotationLabel(annotation: LocalEditAnnotation) {
  return annotation.description.trim() || '未描述区域';
}

/**
 * Unified image local-edit workbench. The exported PNG remains an
 * OpenAI-compatible mask: transparent pixels are regenerated and opaque
 * pixels are protected. The UI deliberately calls this a local edit.
 */
export default function LocalEditEditor({ imageUrl, initialMaskDataUrl, initialPrompt = '', initialAnnotations = [], onApply, onCancel }: LocalEditEditorProps) {
  useBodyScrollLock(true);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const historyRef = useRef<HistoryState>({ states: [], index: -1 });
  const baseMaskRef = useRef<ImageData | null>(null);
  const protectedPixelsRef = useRef<Uint8Array | null>(null);
  const smartMaskPixelsRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  const annotationsRef = useRef<LocalEditAnnotation[]>(normalizeLocalEditAnnotations(initialAnnotations));
  const gestureRef = useRef<Gesture | null>(null);
  const spacePressedRef = useRef(false);
  const sourceImageChangedRef = useRef(false);
  const [tool, setTool] = useState<LocalEditTool>('brush');
  const [brushSize, setBrushSize] = useState(48);
  const [feather, setFeather] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [previewMode, setPreviewMode] = useState<PreviewMode>('overlay');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [annotations, setAnnotations] = useState<LocalEditAnnotation[]>(() => copyAnnotations(annotationsRef.current));
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [movingAnnotation, setMovingAnnotation] = useState<MovingAnnotation | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartError, setSmartError] = useState('');
  const [coverage, setCoverage] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [, setHistoryVersion] = useState(0);

  const refreshPreview = () => {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;
    setCoverage(drawMaskOverlay(mask, overlay, feather));
  };

  useEffect(() => {
    if (ready) refreshPreview();
  }, [feather, ready]);

  const captureSnapshot = (snapshotAnnotations = annotationsRef.current): HistorySnapshot | null => {
    const imageCanvas = imageCanvasRef.current;
    const imageContext = imageCanvas?.getContext('2d');
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!imageCanvas || !imageContext || !canvas || !context) return null;
    const currentImage = imageContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
    const current = context.getImageData(0, 0, canvas.width, canvas.height);
    const base = baseMaskRef.current || copyImageData(current);
    const protectedPixels = protectedPixelsRef.current || new Uint8Array(canvas.width * canvas.height);
    return {
      image: copyImageData(currentImage),
      mask: copyImageData(current),
      baseMask: copyImageData(base),
      annotations: copyAnnotations(snapshotAnnotations),
      protectedPixels: new Uint8Array(protectedPixels),
      smartMasks: copySmartMasks(smartMaskPixelsRef.current),
    };
  };

  const rebuildMask = (nextAnnotations = annotations) => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    if (!baseMaskRef.current || baseMaskRef.current.width !== canvas.width || baseMaskRef.current.height !== canvas.height) {
      baseMaskRef.current = context.createImageData(canvas.width, canvas.height);
      for (let index = 0; index < baseMaskRef.current.data.length; index += 4) {
        baseMaskRef.current.data[index] = 255;
        baseMaskRef.current.data[index + 1] = 255;
        baseMaskRef.current.data[index + 2] = 255;
        baseMaskRef.current.data[index + 3] = 255;
      }
    }
    if (!protectedPixelsRef.current || protectedPixelsRef.current.length !== canvas.width * canvas.height) {
      protectedPixelsRef.current = new Uint8Array(canvas.width * canvas.height);
    }
    const image = copyImageData(baseMaskRef.current);
    nextAnnotations.forEach((annotation) => applyLocalEditAnnotationMask(
      image.data,
      canvas.width,
      canvas.height,
      annotation,
      'edit',
      smartMaskPixelsRef.current.get(annotation.id),
    ));
    for (let pixel = 0; pixel < protectedPixelsRef.current.length; pixel += 1) {
      if (protectedPixelsRef.current[pixel]) image.data[pixel * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    refreshPreview();
  };

  const pushHistory = (before?: HistorySnapshot | null) => {
    const after = captureSnapshot();
    if (!after || (before && sameSnapshot(before, after))) return;
    const history = historyRef.current;
    const nextStates = history.states.slice(0, history.index + 1);
    nextStates.push(after);
    while (nextStates.length > 21) nextStates.shift();
    historyRef.current = { states: nextStates, index: nextStates.length - 1 };
    setHistoryVersion((value) => value + 1);
  };

  const restoreSnapshot = (state: HistorySnapshot) => {
    const imageCanvas = imageCanvasRef.current;
    const imageContext = imageCanvas?.getContext('2d');
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!imageCanvas || !imageContext || !canvas || !context) return;
    imageContext.putImageData(copyImageData(state.image), 0, 0);
    baseMaskRef.current = copyImageData(state.baseMask);
    protectedPixelsRef.current = new Uint8Array(state.protectedPixels);
    smartMaskPixelsRef.current = new Map(state.smartMasks.map(([id, pixels]) => [id, new Uint8ClampedArray(pixels)]));
    annotationsRef.current = copyAnnotations(state.annotations);
    setAnnotations(annotationsRef.current);
    context.putImageData(copyImageData(state.mask), 0, 0);
    refreshPreview();
  };

  const restoreHistory = (index: number) => {
    const state = historyRef.current.states[index];
    if (!state) return;
    restoreSnapshot(state);
    historyRef.current.index = index;
    setHistoryVersion((value) => value + 1);
  };

  const undo = () => {
    if (pendingAnnotation || movingAnnotation) return;
    if (historyRef.current.index > 0) restoreHistory(historyRef.current.index - 1);
  };

  const redo = () => {
    if (pendingAnnotation || movingAnnotation) return;
    if (historyRef.current.index + 1 < historyRef.current.states.length) restoreHistory(historyRef.current.index + 1);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!saving) onCancel();
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        spacePressedRef.current = true;
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [onCancel, saving, pendingAnnotation, movingAnnotation]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError('');
    setCoverage(0);
    setZoom(1);
    setFitSize({ width: 0, height: 0 });
    setPan({ x: 0, y: 0 });
    annotationsRef.current = normalizeLocalEditAnnotations(initialAnnotations);
    setAnnotations(copyAnnotations(annotationsRef.current));
    setPendingAnnotation(null);
    setEditingAnnotationId(null);
    setMovingAnnotation(null);
    sourceImageChangedRef.current = false;
    setSmartError('');
    baseMaskRef.current = null;
    protectedPixelsRef.current = null;
    smartMaskPixelsRef.current.clear();
    historyRef.current = { states: [], index: -1 };
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvases = [imageCanvasRef.current, overlayCanvasRef.current, maskCanvasRef.current];
      canvases.forEach((canvas) => {
        if (canvas) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
        }
      });
      const base = imageCanvasRef.current?.getContext('2d');
      if (base) {
        base.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
        base.drawImage(image, 0, 0);
      }
      const mask = maskCanvasRef.current;
      const maskContext = mask?.getContext('2d');
      if (!mask || !maskContext) return;
      const initialize = async () => {
        if (cancelled) return;
        const restoredAnnotations = normalizeLocalEditAnnotations(initialAnnotations);
        smartMaskPixelsRef.current.clear();
        await Promise.all(restoredAnnotations.map(async (annotation) => {
          const dataUrl = annotation.geometry.kind === 'smart' ? annotation.geometry.maskDataUrl : undefined;
          if (!dataUrl) return;
          try {
            smartMaskPixelsRef.current.set(annotation.id, await loadMaskPixels(dataUrl, mask.width, mask.height));
          } catch {
            // A persisted smart mask can be unavailable after a cleanup. The
            // normalized bounds remain usable as a manual fallback.
          }
        }));
        if (cancelled) return;
        // A persisted mask already contains the merged selection. When its
        // annotations are present, rebuild from a protected base so deleting
        // or moving one marker can actually remove its old pixels. A legacy
        // mask without metadata remains fully editable for compatibility.
        baseMaskRef.current = restoredAnnotations.length
          ? createProtectedImageData(mask.width, mask.height)
          : copyImageData(maskContext.getImageData(0, 0, mask.width, mask.height));
        protectedPixelsRef.current = new Uint8Array(mask.width * mask.height);
        rebuildMask(restoredAnnotations);
        annotationsRef.current = restoredAnnotations;
        setAnnotations(copyAnnotations(restoredAnnotations));
        const initial = captureSnapshot(restoredAnnotations);
        if (!initial) return;
        historyRef.current = { states: [initial], index: 0 };
        refreshPreview();
        setReady(true);
      };
      maskContext.clearRect(0, 0, mask.width, mask.height);
      maskContext.fillStyle = '#fff';
      maskContext.fillRect(0, 0, mask.width, mask.height);
      if (!initialMaskDataUrl) {
        void initialize();
        return;
      }
      const existingMask = new Image();
      existingMask.onload = () => {
        if (cancelled) return;
        maskContext.clearRect(0, 0, mask.width, mask.height);
        maskContext.drawImage(existingMask, 0, 0, mask.width, mask.height);
        void initialize();
      };
      existingMask.onerror = () => { void initialize(); };
      existingMask.src = initialMaskDataUrl;
    };
    image.onerror = () => {
      if (!cancelled) setError('无法读取原图，请检查图片地址或重新上传');
    };
    image.src = imageUrl;
    imageRef.current = image;
    return () => { cancelled = true; };
  }, [imageUrl, initialMaskDataUrl]);

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
    };
  }

  function radiusFor() {
    // Brush size is expressed in source-image pixels. The canvas is rendered
    // at a different CSS size and the mask canvas is hidden, so deriving the
    // radius from a DOM rect makes the brush unstable or effectively full
    // image in embedded browsers.
    return Math.max(1, brushSize / 2);
  }

  function drawBrush(context: CanvasRenderingContext2D, current: Point, previous?: Point) {
    const erase = tool === 'eraser';
    context.save();
    context.globalCompositeOperation = erase ? 'source-over' : 'destination-out';
    context.fillStyle = '#fff';
    context.strokeStyle = '#fff';
    context.lineWidth = radiusFor() * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (previous) {
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    } else {
      context.arc(current.x, current.y, radiusFor(), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawShape(context: CanvasRenderingContext2D, start: Point, end: Point) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#fff';
    context.beginPath();
    if (tool === 'ellipse') {
      context.ellipse(left + width / 2, top + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
    } else {
      context.rect(left, top, width, height);
    }
    context.fill();
    context.restore();
  }

  function drawLasso(context: CanvasRenderingContext2D, path: Point[]) {
    if (path.length < 2) return;
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#fff';
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    path.slice(1).forEach((item) => context.lineTo(item.x, item.y));
    context.closePath();
    context.fill();
    context.restore();
  }

  function normalizedPoint(value: Point) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, value.x / Math.max(1, canvas.width))),
      y: Math.max(0, Math.min(1, value.y / Math.max(1, canvas.height))),
    };
  }

  function annotationForGesture(gesture: Gesture): LocalEditAnnotation | null {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !gesture.start) return null;
    const point = normalizedPoint(gesture.start);
    const id = `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let geometry: LocalEditAnnotationGeometry;
    if (gesture.kind === 'shape' && gesture.last) {
      const end = normalizedPoint(gesture.last);
      geometry = {
        kind: tool as 'rectangle' | 'ellipse',
        x: Math.min(point.x, end.x),
        y: Math.min(point.y, end.y),
        width: Math.max(0.002, Math.abs(end.x - point.x)),
        height: Math.max(0.002, Math.abs(end.y - point.y)),
      };
    } else if (gesture.kind === 'lasso' && gesture.path && gesture.path.length >= 3) {
      geometry = { kind: 'lasso', points: gesture.path.map(normalizedPoint) };
    } else if (tool === 'point') {
      geometry = { kind: 'point', x: point.x, y: point.y, radius: Math.max(0.001, radiusFor() / Math.max(canvas.width, canvas.height)) };
    } else if (gesture.points?.length) {
      geometry = {
        kind: 'brush',
        points: gesture.points.map(normalizedPoint),
        radius: Math.max(0.001, radiusFor() / Math.max(canvas.width, canvas.height)),
      };
    } else {
      return null;
    }
    return { id, kind: geometry.kind, description: '', geometry, createdAt: Date.now() };
  }

  async function handleSmartSelection(current: Point, before: HistorySnapshot) {
    const base = imageCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;
    if (annotations.length >= 16) {
      setSmartError('最多可以添加 16 个局部标记');
      return;
    }
    if (!getLocalSegmentationProvider()) {
      setSmartError(localSegmentationUnavailableMessage());
      return;
    }
    try {
      setSmartBusy(true);
      setSmartError('');
      const result = await segmentLocalSubject(base.toDataURL('image/png'), normalizedPoint(current));
      if (!result.maskDataUrl) throw new Error('智能识别没有返回有效主体遮罩，请改用手动标记');
      const rawBounds = result.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const bounds = {
        x: Math.max(0, Math.min(1, Number(rawBounds.x) || 0)),
        y: Math.max(0, Math.min(1, Number(rawBounds.y) || 0)),
        width: Math.max(0.002, Math.min(1, Number(rawBounds.width) || 1)),
        height: Math.max(0.002, Math.min(1, Number(rawBounds.height) || 1)),
      };
      bounds.width = Math.min(bounds.width, 1 - bounds.x);
      bounds.height = Math.min(bounds.height, 1 - bounds.y);
      const annotation: LocalEditAnnotation = {
        id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'smart',
        description: '',
        geometry: {
          kind: 'smart',
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          ...(result.maskDataUrl ? { maskDataUrl: result.maskDataUrl } : {}),
        },
        createdAt: Date.now(),
      };
      smartMaskPixelsRef.current.set(annotation.id, await loadMaskPixels(result.maskDataUrl, base.width, base.height));
      commitAnnotation(annotation, before);
    } catch (cause) {
      setSmartError(cause instanceof Error ? cause.message : '智能识别失败，请改用手动标记');
      restoreSnapshot(before);
    } finally {
      setSmartBusy(false);
    }
  }

  function moveGeometry(geometry: LocalEditAnnotationGeometry, dx: number, dy: number): LocalEditAnnotationGeometry {
    const shiftPoint = (point: LocalEditPoint): LocalEditPoint => ({ x: Math.max(0, Math.min(1, point.x + dx)), y: Math.max(0, Math.min(1, point.y + dy)) });
    if (geometry.kind === 'point') return { ...geometry, x: Math.max(0, Math.min(1, geometry.x + dx)), y: Math.max(0, Math.min(1, geometry.y + dy)) };
    if (geometry.kind === 'brush' || geometry.kind === 'lasso') return { ...geometry, points: geometry.points.map(shiftPoint) };
    return { ...geometry, x: Math.max(0, Math.min(1 - geometry.width, geometry.x + dx)), y: Math.max(0, Math.min(1 - geometry.height, geometry.y + dy)) };
  }

  function selectionMaskForAnnotation(annotation: LocalEditAnnotation, width: number, height: number, smartPixels?: Uint8ClampedArray) {
    const selection = createProtectedImageData(width, height);
    applyLocalEditAnnotationMask(selection.data, width, height, annotation, 'edit', smartPixels);
    return selection.data;
  }

  function beginMoveAnnotation(event: React.PointerEvent, annotation: LocalEditAnnotation) {
    if (saving || pendingAnnotation) return;
    event.preventDefault();
    event.stopPropagation();
    const imageCanvas = imageCanvasRef.current;
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!imageCanvas || !canvas || !context) return;
    const before = captureSnapshot();
    if (!before) return;
    setMovingAnnotation({
      id: annotation.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial: annotation,
      before,
      selectionMask: selectionMaskForAnnotation(
        annotation,
        canvas.width,
        canvas.height,
        smartMaskPixelsRef.current.get(annotation.id),
      ),
      ...(smartMaskPixelsRef.current.has(annotation.id)
        ? { initialSmartMask: new Uint8ClampedArray(smartMaskPixelsRef.current.get(annotation.id)!) }
        : {}),
    });
  }

  useEffect(() => {
    if (!movingAnnotation) return;
    const canvas = overlayCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    const imageContext = imageCanvas?.getContext('2d');
    if (!canvas || !imageCanvas || !imageContext) return;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== movingAnnotation.pointerId) return;
      const rawDx = (event.clientX - movingAnnotation.startX) / Math.max(1, canvas.getBoundingClientRect().width);
      const rawDy = (event.clientY - movingAnnotation.startY) / Math.max(1, canvas.getBoundingClientRect().height);
      const bounds = annotationPreviewBounds(movingAnnotation.initial);
      const dx = Math.max(-bounds.x, Math.min(1 - bounds.x - bounds.width, rawDx));
      const dy = Math.max(-bounds.y, Math.min(1 - bounds.y - bounds.height, rawDy));
      if (dx !== 0 || dy !== 0) sourceImageChangedRef.current = true;
      const movedPixels = moveLocalEditPixels(
        movingAnnotation.before.image.data,
        movingAnnotation.selectionMask,
        imageCanvas.width,
        imageCanvas.height,
        dx * imageCanvas.width,
        dy * imageCanvas.height,
      );
      imageContext.putImageData(new ImageData(movedPixels, imageCanvas.width, imageCanvas.height), 0, 0);

      // Keep the cleared source location editable as well as the new target
      // location. This is what lets the provider repair the hole left behind
      // by a moved object instead of protecting the old pixels again.
      baseMaskRef.current = copyImageData(movingAnnotation.before.baseMask);
      applyLocalEditAnnotationMask(
        baseMaskRef.current.data,
        canvas.width,
        canvas.height,
        movingAnnotation.initial,
        'edit',
        movingAnnotation.initialSmartMask,
      );
      let next = annotationsRef.current.map((item) => item.id === movingAnnotation.id ? { ...item, geometry: moveGeometry(movingAnnotation.initial.geometry, dx, dy) } : item);
      let moved = next.find((item) => item.id === movingAnnotation.id);
      if (moved?.geometry.kind === 'smart' && movingAnnotation.initialSmartMask) {
        const translated = translateMaskPixels(
          movingAnnotation.initialSmartMask,
          canvas.width,
          canvas.height,
          dx * canvas.width,
          dy * canvas.height,
        );
        smartMaskPixelsRef.current.set(moved.id, translated);
        // Keep the current geometry lightweight while dragging. The data URL
        // is refreshed once on pointerup so a reopened editor gets the moved
        // subject mask instead of the provider's original position.
      }
      if (moved) allowAnnotationToOverrideProtection(moved);
      annotationsRef.current = next;
      setAnnotations(next);
      rebuildMask(next);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== movingAnnotation.pointerId) return;
      if (event.type === 'pointercancel') {
        restoreSnapshot(movingAnnotation.before);
        setMovingAnnotation(null);
        return;
      }
      const moved = annotationsRef.current.find((item) => item.id === movingAnnotation.id);
      if (moved?.geometry.kind === 'smart') {
        const pixels = smartMaskPixelsRef.current.get(moved.id);
        if (pixels) {
          const persisted = {
            ...moved,
            geometry: { ...moved.geometry, maskDataUrl: maskPixelsToDataUrl(pixels, canvas.width, canvas.height) },
          } as LocalEditAnnotation;
          const next = annotationsRef.current.map((item) => item.id === moved.id ? persisted : item);
          annotationsRef.current = next;
          setAnnotations(next);
          rebuildMask(next);
        }
      }
      pushHistory(movingAnnotation.before);
      setMovingAnnotation(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [movingAnnotation]);

  function allowAnnotationToOverrideProtection(annotation: LocalEditAnnotation) {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const selection = new ImageData(canvas.width, canvas.height);
    for (let index = 0; index < selection.data.length; index += 4) {
      selection.data[index] = 255;
      selection.data[index + 1] = 255;
      selection.data[index + 2] = 255;
      selection.data[index + 3] = 255;
    }
    applyLocalEditAnnotationMask(
      selection.data,
      canvas.width,
      canvas.height,
      annotation,
      'edit',
      smartMaskPixelsRef.current.get(annotation.id),
    );
    if (!protectedPixelsRef.current) protectedPixelsRef.current = new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0; pixel < protectedPixelsRef.current.length; pixel += 1) {
      if (selection.data[pixel * 4 + 3] < 128) protectedPixelsRef.current[pixel] = 0;
    }
  }

  function confirmAnnotation() {
    if (!pendingAnnotation) return;
    const next = [...annotations, { ...pendingAnnotation.annotation, description: annotationDraft.trim() }].slice(0, 16);
    allowAnnotationToOverrideProtection(pendingAnnotation.annotation);
    annotationsRef.current = next;
    setAnnotations(next);
    rebuildMask(next);
    pushHistory(pendingAnnotation.before);
    setPendingAnnotation(null);
    setAnnotationDraft('');
  }

  function commitAnnotation(annotation: LocalEditAnnotation, before: HistorySnapshot) {
    allowAnnotationToOverrideProtection(annotation);
    const next = [...annotations, annotation].slice(0, 16);
    annotationsRef.current = next;
    setAnnotations(next);
    rebuildMask(next);
    pushHistory(before);
  }

  function cancelPendingAnnotation() {
    if (!pendingAnnotation) return;
    restoreSnapshot(pendingAnnotation.before);
    setPendingAnnotation(null);
    setEditingAnnotationId(null);
    setAnnotationDraft('');
    refreshPreview();
  }

  function editAnnotation(annotation: LocalEditAnnotation) {
    if (pendingAnnotation || movingAnnotation) return;
    setEditingAnnotationId(annotation.id);
    setAnnotationDraft(annotation.description);
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    const bounds = annotationBounds(annotation);
    setPendingAnnotation({
      annotation,
      before: captureSnapshot() || {
        image: new ImageData(1, 1),
        mask: new ImageData(1, 1),
        baseMask: new ImageData(1, 1),
        annotations: copyAnnotations(annotations),
        protectedPixels: new Uint8Array(1),
        smartMasks: [],
      },
      anchor: {
        x: (bounds.x + bounds.width / 2) * Math.max(1, canvas?.width || 1),
        y: (bounds.y + bounds.height / 2) * Math.max(1, canvas?.height || 1),
      },
    });
  }

  function saveEditedAnnotation() {
    if (!editingAnnotationId) return;
    const next = annotations.map((item) => item.id === editingAnnotationId ? { ...item, description: annotationDraft.trim() } : item);
    annotationsRef.current = next;
    setAnnotations(next);
    rebuildMask(next);
    pushHistory(pendingAnnotation?.before);
    setEditingAnnotationId(null);
    setPendingAnnotation(null);
    setAnnotationDraft('');
  }

  function confirmPendingAnnotation() {
    if (editingAnnotationId) {
      saveEditedAnnotation();
      return;
    }
    confirmAnnotation();
  }

  function deleteAnnotation(annotation: LocalEditAnnotation) {
    if (pendingAnnotation || movingAnnotation) return;
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const before = captureSnapshot();
    const next = annotations.filter((item) => item.id !== annotation.id);
    annotationsRef.current = next;
    setAnnotations(next);
    smartMaskPixelsRef.current.delete(annotation.id);
    rebuildMask(next);
    pushHistory(before);
  }

  function commitEraser(before: HistorySnapshot) {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const current = context.getImageData(0, 0, canvas.width, canvas.height);
    const base = baseMaskRef.current ? copyImageData(baseMaskRef.current) : copyImageData(before.baseMask);
    const protectedPixels = protectedPixelsRef.current ? new Uint8Array(protectedPixelsRef.current) : new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0; pixel < protectedPixels.length; pixel += 1) {
      const alphaIndex = pixel * 4 + 3;
      if (current.data[alphaIndex] >= 250 && before.mask.data[alphaIndex] < 250) {
        base.data[alphaIndex] = 255;
        protectedPixels[pixel] = 1;
      }
    }
    baseMaskRef.current = base;
    protectedPixelsRef.current = protectedPixels;
    rebuildMask(annotations);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || saving || pendingAnnotation || movingAnnotation || smartBusy) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget;
    const panGesture = tool === 'pan' || event.button === 1 || spacePressedRef.current;
    const current = point(event);
    const maskContext = maskCanvasRef.current?.getContext('2d');
    const before = captureSnapshot();
    if (tool === 'smart') {
      if (before) void handleSmartSelection(current, before);
      return;
    }
    if (!before) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded webviews can reject capture for a synthetic pointer.
    }
    gestureRef.current = panGesture
      ? { pointerId: event.pointerId, kind: 'pan', panStart: { x: event.clientX - pan.x, y: event.clientY - pan.y } }
      : tool === 'rectangle' || tool === 'ellipse'
        ? { pointerId: event.pointerId, kind: 'shape', before, start: current, last: current }
        : tool === 'lasso'
          ? { pointerId: event.pointerId, kind: 'lasso', before, start: current, last: current, path: [current] }
        : { pointerId: event.pointerId, kind: 'draw', before, last: current, start: current, points: [current] };
    if (!panGesture && (tool === 'brush' || tool === 'eraser' || tool === 'point')) {
      if (maskContext) drawBrush(maskContext, current);
      refreshPreview();
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      if (gesture.panStart) setPan({ x: event.clientX - gesture.panStart.x, y: event.clientY - gesture.panStart.y });
      return;
    }
    const context = maskCanvasRef.current?.getContext('2d');
    if (!context) return;
    if (tool === 'point') return;
    if (gesture.kind === 'shape' && gesture.before && gesture.start) {
      context.putImageData(gesture.before.mask, 0, 0);
      drawShape(context, gesture.start, current);
    } else if (gesture.kind === 'lasso' && gesture.before && gesture.path) {
      const nextPath = [...gesture.path, current];
      context.putImageData(gesture.before.mask, 0, 0);
      drawLasso(context, nextPath);
      gesture.path = nextPath;
    } else {
      drawBrush(context, current, gesture.last);
      if (gesture.points) gesture.points.push(current);
    }
    gesture.last = current;
    refreshPreview();
  }

  function finishGesture(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'pointercancel' && gesture.before) {
      restoreSnapshot(gesture.before);
    } else if (gesture.kind !== 'pan' && gesture.before) {
      if (tool === 'eraser') {
        commitEraser(gesture.before);
        pushHistory(gesture.before);
      } else {
        const annotation = annotationForGesture(gesture);
        if (annotation && annotations.length < 16) {
          commitAnnotation(annotation, gesture.before);
        } else {
          if (annotation) setError('最多可以添加 16 个局部标记');
          const context = maskCanvasRef.current?.getContext('2d');
          if (context) context.putImageData(gesture.before.mask, 0, 0);
          pushHistory(gesture.before);
        }
      }
    }
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    refreshPreview();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    finishGesture(event);
  }

  function handleLostPointerCapture(event: React.PointerEvent<HTMLCanvasElement>) {
    finishGesture(event);
  }

  function resetAll(protect: boolean) {
    if (pendingAnnotation || movingAnnotation) return;
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const before = captureSnapshot();
    context.globalCompositeOperation = 'source-over';
    if (protect) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    baseMaskRef.current = context.getImageData(0, 0, canvas.width, canvas.height);
    protectedPixelsRef.current = new Uint8Array(canvas.width * canvas.height);
    annotationsRef.current = [];
    setAnnotations([]);
    setPendingAnnotation(null);
    pushHistory(before);
    refreshPreview();
  }

  function addIntent(intent: LocalEditIntent) {
    const item = LOCAL_EDIT_INTENTS.find((entry) => entry.value === intent);
    if (!item) return;
    setPrompt((current) => {
      const existing = current.trimEnd();
      return existing ? `${existing}\n${item.prompt}` : item.prompt;
    });
  }

  function zoomBy(delta: number) {
    setZoom((value) => Math.max(0.2, Math.min(3, Number((value + delta).toFixed(2)))));
  }

  function measureFitSize() {
    const stage = canvasStageRef.current;
    const canvas = imageCanvasRef.current;
    if (!stage || !canvas?.width || !canvas.height) return null;
    const availableWidth = Math.max(1, stage.clientWidth);
    const availableHeight = Math.max(1, stage.clientHeight);
    const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
    return {
      width: Math.max(1, Math.floor(canvas.width * scale)),
      height: Math.max(1, Math.floor(canvas.height * scale)),
    };
  }

  function fitCanvas() {
    const nextSize = measureFitSize();
    if (nextSize) setFitSize(nextSize);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    if (!ready) return;
    const updateFitSize = () => {
      const nextSize = measureFitSize();
      if (!nextSize) return;
      setFitSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    };
    updateFitSize();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateFitSize)
      : null;
    if (observer && canvasStageRef.current) observer.observe(canvasStageRef.current);
    window.addEventListener('resize', updateFitSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateFitSize);
    };
  }, [imageUrl, ready]);

  function exportMask() {
    const source = maskCanvasRef.current;
    if (!source) throw new Error('局部编辑范围导出失败，请重试');
    const output = document.createElement('canvas');
    output.width = source.width;
    output.height = source.height;
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('局部编辑范围导出失败，请重试');
    const sourceContext = source.getContext('2d');
    if (!sourceContext) throw new Error('局部编辑范围导出失败，请重试');
    const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
    const pixels = featherLocalEditMask(sourcePixels, source.width, source.height, feather);
    outputContext.putImageData(new ImageData(pixels, output.width, output.height), 0, 0);
    return { dataUrl: output.toDataURL('image/png'), coverage: calculateLocalEditableCoverage(pixels) };
  }

  function exportSourceImage() {
    const source = imageCanvasRef.current;
    if (!source) throw new Error('鏃犳硶瀵煎嚭绉诲姩鍚庣殑鍥剧墖锛岃閲嶈瘯');
    return source.toDataURL('image/png');
  }

  async function applyLocalEdit() {
    if (!ready || saving || pendingAnnotation || movingAnnotation || smartBusy) return;
    if (coverage <= 0) {
      setError('请先指定编辑区域，再应用局部编辑');
      return;
    }
    if (!prompt.trim()) {
      setError('请填写局部编辑提示词，或点击一个快捷模板');
      return;
    }
    try {
      setError('');
      setSaving(true);
      const exported = exportMask();
      await onApply(
        exported.dataUrl,
        exported.coverage,
        compileLocalEditPrompt(prompt, annotations),
        annotations,
        sourceImageChangedRef.current ? exportSourceImage() : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '局部编辑范围导出失败，图片可能受跨域保护');
    } finally {
      setSaving(false);
    }
  }

  const history = historyRef.current;
  const imageCanvas = imageCanvasRef.current;
  const ratio = imageCanvas ? `${imageCanvas.width} / ${imageCanvas.height}` : '16 / 9';
  return (
    <div className="mask-editor-backdrop local-edit-backdrop" style={{ zIndex: CANVAS_Z_INDEX.modal }} onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onCancel(); }}>
      <div className="mask-editor local-edit-workbench surface" role="dialog" aria-modal="true" aria-labelledby="local-edit-title">
        {error && <div className="mask-editor-error local-edit-error" role="alert">{error}</div>}
        <div className="mask-editor-head local-edit-workbench-head">
          <div><span>图片工作台</span><h2 id="local-edit-title">局部编辑</h2><small>透明区域会生成新内容，白色区域保护原图；提交后生成新结果，原图不会被覆盖。</small></div>
          <button type="button" className="icon-button" disabled={saving} onClick={onCancel} aria-label="关闭局部编辑">×</button>
        </div>
        <div className="local-edit-workbench-toolbar" role="toolbar" aria-label="局部编辑工具">
          <div className="local-edit-workbench-tool-row">
            {([
              ['brush', '画笔标记'], ['eraser', '橡皮擦'], ['rectangle', '矩形选区'], ['ellipse', '椭圆选区'], ['lasso', '自由圈选'], ['point', '点选标记'], ['smart', '智能识别'], ['pan', '拖动画布'],
            ] as const).map(([value, label]) => <button key={value} type="button" disabled={!ready || saving || (value === 'smart' && !getLocalSegmentationProvider())} className={tool === value ? 'active' : ''} aria-pressed={tool === value} title={value === 'smart' && !getLocalSegmentationProvider() ? localSegmentationUnavailableMessage() : undefined} onClick={() => setTool(value)}>{label}</button>)}
            <span className="local-edit-pan-hint" role="note" aria-label="按住鼠标中键拖动画布">
              <span className="local-edit-pan-mouse" aria-hidden="true">
                <svg viewBox="0 0 32 42" focusable="false">
                  <rect x="5" y="2" width="22" height="38" rx="11" />
                  <path d="M16 3v13" />
                  <rect className="wheel" x="13" y="8" width="6" height="10" rx="3" />
                  <path className="wheel-arrow" d="m12 24 4-4 4 4M16 20v9" />
                </svg>
              </span>
              <span className="local-edit-pan-copy"><b>中键拖动</b><small>也可 Space + 左键</small></span>
            </span>
          </div>
          <div className="local-edit-workbench-tool-row local-edit-workbench-view-tools">
            <button type="button" disabled={!ready || saving} onClick={undo} title="Ctrl/Cmd + Z">撤销</button>
            <button type="button" disabled={!ready || saving} onClick={redo} title="Ctrl/Cmd + Shift + Z">重做</button>
            <button type="button" disabled={!ready || saving} onClick={() => zoomBy(-0.1)}>−</button>
            <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
            <button type="button" disabled={!ready || saving} onClick={() => zoomBy(0.1)}>＋</button>
            <button type="button" disabled={!ready || saving} onClick={fitCanvas}>适应</button>
          </div>
        </div>
        <div className="local-edit-workbench-body">
          <div ref={canvasStageRef} className="local-edit-canvas-stage" data-preview={previewMode} onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY > 0 ? -0.1 : 0.1); }}>
            {!ready && <div className="mask-loading">正在读取图片…</div>}
            <div className="local-edit-canvas-stack" style={{ aspectRatio: ratio, width: fitSize.width || undefined, height: fitSize.height || undefined, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: useToolCursor(tool) }}>
              <canvas ref={imageCanvasRef} className="mask-canvas base" aria-label="原图预览" />
              <canvas ref={overlayCanvasRef} className="mask-canvas overlay" aria-label="局部编辑范围" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={handleLostPointerCapture} />
              <canvas ref={maskCanvasRef} className="mask-canvas mask-data" aria-hidden="true" />
              <div className="local-edit-annotation-layer" aria-label="局部标记">
                {annotations.map((annotation, index) => {
                  const bounds = annotationBounds(annotation);
                  return (
                    <div
                      key={annotation.id}
                      className="local-edit-annotation"
                      style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${Math.max(1, bounds.width * 100)}%`, height: `${Math.max(1, bounds.height * 100)}%` }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <span className="local-edit-annotation-index">{index + 1}</span>
                      <div className="local-edit-annotation-toolbar">
                        <span className="local-edit-selection-thumb" role="img" aria-label="选区预览" style={annotationPreviewStyle(annotation, imageUrl)} />
                        <strong title={annotationLabel(annotation)}>{annotationLabel(annotation)}</strong>
                        <button type="button" onClick={() => editAnnotation(annotation)}>修改</button>
                        <button type="button" onPointerDown={(event) => beginMoveAnnotation(event, annotation)}>移动选区</button>
                        <button type="button" className="danger" onClick={() => deleteAnnotation(annotation)}>删除</button>
                      </div>
                    </div>
                  );
                })}
                {pendingAnnotation && (() => {
                  const left = pendingAnnotation.anchor.x / Math.max(1, imageCanvas?.width || 1);
                  const top = pendingAnnotation.anchor.y / Math.max(1, imageCanvas?.height || 1);
                  return (
                    <div className="local-edit-annotation-popover" style={{ left: `${Math.max(2, Math.min(72, left * 100))}%`, top: `${Math.max(2, Math.min(78, top * 100))}%` }} onPointerDown={(event) => event.stopPropagation()}>
                      <input autoFocus value={annotationDraft} disabled={saving} onChange={(event) => setAnnotationDraft(event.target.value)} placeholder="补充移动说明" aria-label="局部标记描述" />
                      <button type="button" disabled={saving} onClick={confirmPendingAnnotation}>{editingAnnotationId ? '保存' : '添加'}</button>
                      <button type="button" disabled={saving} onClick={cancelPendingAnnotation}>取消</button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="local-edit-workbench-sidebar">
            <div className="local-edit-workbench-summary">
                <span>编辑范围 <b>{formatCoverage(coverage)}</b></span>
              <span>历史 {Math.max(0, history.index)} / 20</span>
              <div className="local-edit-preview-switch" role="group" aria-label="预览模式">
                {([['overlay', '叠加预览'], ['original', '原图'], ['range', '编辑范围']] as const).map(([value, label]) => <button key={value} type="button" className={previewMode === value ? 'active' : ''} aria-pressed={previewMode === value} onClick={() => setPreviewMode(value)}>{label}</button>)}
              </div>
            </div>
            <div className="local-edit-workbench-controls">
              <label><span>画笔大小</span><input type="range" min="8" max="180" value={brushSize} disabled={!ready || saving} onChange={(event) => setBrushSize(Number(event.target.value))} /><b>{brushSize}px</b></label>
              <label><span>边缘羽化</span><input type="range" min="0" max="48" value={feather} disabled={!ready || saving} onChange={(event) => setFeather(Number(event.target.value))} /><b>{feather}px</b></label>
            </div>
             <div className="local-edit-intents" aria-label="提示词快捷模板">
              <span>快捷意图</span>
              {LOCAL_EDIT_INTENTS.map((intent) => <button key={intent.value} type="button" disabled={saving} onClick={() => addIntent(intent.value)}>{intent.label}</button>)}
             </div>
             <div className="local-edit-annotation-summary" aria-live="polite">
               <span>局部标记</span><b>{annotations.length} / 16</b>
               {annotations.length > 0 && <div>{annotations.map((annotation, index) => <button key={annotation.id} type="button" title={annotationLabel(annotation)} onClick={() => editAnnotation(annotation)}><span className="local-edit-selection-thumb" aria-hidden="true" style={annotationPreviewStyle(annotation, imageUrl)} /><span>{index + 1} · {annotationLabel(annotation)}</span></button>)}</div>}
             </div>
             {smartError && <div className="local-edit-smart-note" role="status">{smartError}</div>}
             <label className="local-edit-prompt"><span>编辑提示词</span><textarea value={prompt} disabled={saving} onChange={(event) => setPrompt(event.target.value)} placeholder="描述编辑范围内要移除、替换或添加的内容…" /></label>
            <div className="local-edit-workbench-presets"><button type="button" disabled={!ready || saving} onClick={() => resetAll(true)}>保护全图</button><button type="button" disabled={!ready || saving} onClick={() => resetAll(false)}>编辑全图</button><small>红色区域是编辑范围；橡皮擦会恢复保护。</small></div>
            <div className="mask-editor-actions local-edit-workbench-actions"><button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="primary-action compact" disabled={!ready || saving || Boolean(pendingAnnotation) || Boolean(movingAnnotation) || smartBusy || coverage <= 0} onClick={() => void applyLocalEdit()}>{saving ? '正在提交…' : '应用局部编辑'}</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compatibility export for code that has not moved its import yet. */
export { LocalEditEditor as MaskEditor };

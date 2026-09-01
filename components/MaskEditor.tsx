'use client';

import { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';
import { calculateEditableCoverage as calculateLocalEditableCoverage } from '@/lib/local-edit';

export type LocalEditIntent = 'remove' | 'replace' | 'add' | 'subject';

export type LocalEditEditorProps = {
  imageUrl: string;
  initialMaskDataUrl?: string;
  initialPrompt?: string;
  onApply: (maskDataUrl: string, coverage: number, prompt: string) => void | Promise<void>;
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

type LocalEditTool = 'brush' | 'eraser' | 'rectangle' | 'ellipse' | 'pan';
type PreviewMode = 'overlay' | 'original' | 'range';
type Point = { x: number; y: number };
type HistoryState = { states: ImageData[]; index: number };
type Gesture = {
  pointerId: number;
  kind: 'draw' | 'shape' | 'pan';
  before?: ImageData;
  start?: Point;
  last?: Point;
  panStart?: Point;
  moved?: boolean;
};

function samePixels(left: ImageData, right: ImageData) {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) return false;
  for (let index = 0; index < left.data.length; index += 1) {
    if (left.data[index] !== right.data[index]) return false;
  }
  return true;
}

function drawMaskOverlay(mask: HTMLCanvasElement, overlay: HTMLCanvasElement) {
  const maskContext = mask.getContext('2d');
  const overlayContext = overlay.getContext('2d');
  if (!maskContext || !overlayContext) return 0;
  const source = maskContext.getImageData(0, 0, mask.width, mask.height);
  const output = overlayContext.createImageData(mask.width, mask.height);
  for (let index = 0; index < source.data.length; index += 4) {
    const editable = 255 - source.data[index + 3];
    output.data[index] = 239;
    output.data[index + 1] = 68;
    output.data[index + 2] = 68;
    output.data[index + 3] = Math.round(Math.min(180, editable * 0.7));
  }
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  overlayContext.putImageData(output, 0, 0);
  return calculateLocalEditableCoverage(source.data);
}

function useToolCursor(tool: LocalEditTool) {
  if (tool === 'pan') return 'grab';
  if (tool === 'eraser') return 'cell';
  return 'crosshair';
}

/**
 * Unified image local-edit workbench. The exported PNG remains an
 * OpenAI-compatible mask: transparent pixels are regenerated and opaque
 * pixels are protected. The UI deliberately calls this a local edit.
 */
export default function LocalEditEditor({ imageUrl, initialMaskDataUrl, initialPrompt = '', onApply, onCancel }: LocalEditEditorProps) {
  useBodyScrollLock(true);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const historyRef = useRef<HistoryState>({ states: [], index: -1 });
  const gestureRef = useRef<Gesture | null>(null);
  const spacePressedRef = useRef(false);
  const [tool, setTool] = useState<LocalEditTool>('brush');
  const [brushSize, setBrushSize] = useState(48);
  const [feather, setFeather] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [previewMode, setPreviewMode] = useState<PreviewMode>('overlay');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [coverage, setCoverage] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [, setHistoryVersion] = useState(0);

  const refreshPreview = () => {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;
    setCoverage(drawMaskOverlay(mask, overlay));
  };

  const pushHistory = (before?: ImageData) => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const after = context.getImageData(0, 0, canvas.width, canvas.height);
    if (before && samePixels(before, after)) return;
    const history = historyRef.current;
    const nextStates = history.states.slice(0, history.index + 1);
    nextStates.push(after);
    while (nextStates.length > 21) nextStates.shift();
    historyRef.current = { states: nextStates, index: nextStates.length - 1 };
    setHistoryVersion((value) => value + 1);
  };

  const restoreHistory = (index: number) => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    const state = historyRef.current.states[index];
    if (!canvas || !context || !state) return;
    context.putImageData(state, 0, 0);
    historyRef.current.index = index;
    refreshPreview();
    setHistoryVersion((value) => value + 1);
  };

  const undo = () => {
    if (historyRef.current.index > 0) restoreHistory(historyRef.current.index - 1);
  };

  const redo = () => {
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
  }, [onCancel, saving]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError('');
    setCoverage(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
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
      const initialize = () => {
        if (cancelled) return;
        const initial = maskContext.getImageData(0, 0, mask.width, mask.height);
        historyRef.current = { states: [initial], index: 0 };
        refreshPreview();
        setReady(true);
      };
      maskContext.clearRect(0, 0, mask.width, mask.height);
      maskContext.fillStyle = '#fff';
      maskContext.fillRect(0, 0, mask.width, mask.height);
      if (!initialMaskDataUrl) {
        initialize();
        return;
      }
      const existingMask = new Image();
      existingMask.onload = () => {
        if (cancelled) return;
        maskContext.clearRect(0, 0, mask.width, mask.height);
        maskContext.drawImage(existingMask, 0, 0, mask.width, mask.height);
        initialize();
      };
      existingMask.onerror = initialize;
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

  function radiusFor(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const unscaledWidth = rect.width / Math.max(0.5, zoom);
    return brushSize * canvas.width / Math.max(1, unscaledWidth) / 2;
  }

  function drawBrush(context: CanvasRenderingContext2D, current: Point, previous?: Point) {
    const canvas = context.canvas;
    const erase = tool === 'eraser';
    context.save();
    context.globalCompositeOperation = erase ? 'source-over' : 'destination-out';
    context.fillStyle = '#fff';
    context.strokeStyle = '#fff';
    context.lineWidth = radiusFor(canvas) * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (previous) {
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    } else {
      context.arc(current.x, current.y, radiusFor(canvas), 0, Math.PI * 2);
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

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || saving) return;
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const panGesture = tool === 'pan' || event.button === 1 || spacePressedRef.current;
    const current = point(event);
    const maskContext = maskCanvasRef.current?.getContext('2d');
    const before = maskContext?.getImageData(0, 0, canvas.width, canvas.height);
    gestureRef.current = panGesture
      ? { pointerId: event.pointerId, kind: 'pan', panStart: { x: event.clientX - pan.x, y: event.clientY - pan.y } }
      : tool === 'rectangle' || tool === 'ellipse'
        ? { pointerId: event.pointerId, kind: 'shape', before, start: current, last: current }
        : { pointerId: event.pointerId, kind: 'draw', before, last: current };
    if (!panGesture && (tool === 'brush' || tool === 'eraser')) {
      if (maskContext) drawBrush(maskContext, current);
      refreshPreview();
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = point(event);
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      if (gesture.panStart) setPan({ x: event.clientX - gesture.panStart.x, y: event.clientY - gesture.panStart.y });
      return;
    }
    const context = maskCanvasRef.current?.getContext('2d');
    if (!context) return;
    if (gesture.kind === 'shape' && gesture.before && gesture.start) {
      context.putImageData(gesture.before, 0, 0);
      drawShape(context, gesture.start, current);
    } else {
      drawBrush(context, current, gesture.last);
    }
    gesture.last = current;
    refreshPreview();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.kind !== 'pan') pushHistory(gesture.before);
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    refreshPreview();
  }

  function resetAll(protect: boolean) {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const before = context.getImageData(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = protect ? '#fff' : 'rgba(0,0,0,0)';
    context.fillRect(0, 0, canvas.width, canvas.height);
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
    setZoom((value) => Math.max(0.5, Math.min(3, Number((value + delta).toFixed(2)))));
  }

  function exportMask() {
    const source = maskCanvasRef.current;
    if (!source) throw new Error('局部编辑范围导出失败，请重试');
    const output = document.createElement('canvas');
    output.width = source.width;
    output.height = source.height;
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('局部编辑范围导出失败，请重试');
    if (feather > 0) {
      outputContext.filter = `blur(${feather}px)`;
      outputContext.drawImage(source, 0, 0);
      outputContext.filter = 'none';
    } else {
      outputContext.drawImage(source, 0, 0);
    }
    const pixels = outputContext.getImageData(0, 0, output.width, output.height).data;
    return { dataUrl: output.toDataURL('image/png'), coverage: calculateLocalEditableCoverage(pixels) };
  }

  async function applyLocalEdit() {
    if (!ready || saving) return;
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
      await onApply(exported.dataUrl, exported.coverage, prompt.trim());
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
              ['brush', '画笔'], ['eraser', '橡皮擦'], ['rectangle', '矩形选区'], ['ellipse', '椭圆选区'], ['pan', '拖动画布'],
            ] as const).map(([value, label]) => <button key={value} type="button" disabled={!ready || saving} className={tool === value ? 'active' : ''} aria-pressed={tool === value} onClick={() => setTool(value)}>{label}</button>)}
          </div>
          <div className="local-edit-workbench-tool-row local-edit-workbench-view-tools">
            <button type="button" disabled={!ready || saving} onClick={undo} title="Ctrl/Cmd + Z">撤销</button>
            <button type="button" disabled={!ready || saving} onClick={redo} title="Ctrl/Cmd + Shift + Z">重做</button>
            <button type="button" disabled={!ready || saving} onClick={() => zoomBy(-0.1)}>−</button>
            <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
            <button type="button" disabled={!ready || saving} onClick={() => zoomBy(0.1)}>＋</button>
            <button type="button" disabled={!ready || saving} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>适应</button>
          </div>
        </div>
        <div className="local-edit-canvas-stage" data-preview={previewMode} onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY > 0 ? -0.1 : 0.1); }}>
          {!ready && <div className="mask-loading">正在读取图片…</div>}
          <div className="local-edit-canvas-stack" style={{ aspectRatio: ratio, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: useToolCursor(tool) }}>
            <canvas ref={imageCanvasRef} className="mask-canvas base" aria-label="原图预览" />
            <canvas ref={overlayCanvasRef} className="mask-canvas overlay" aria-label="局部编辑范围" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
            <canvas ref={maskCanvasRef} className="mask-canvas mask-data" aria-hidden="true" />
          </div>
        </div>
        <div className="local-edit-workbench-summary">
          <span>编辑范围 <b>{Math.round(coverage * 100)}%</b></span>
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
        <label className="local-edit-prompt"><span>编辑提示词</span><textarea value={prompt} disabled={saving} onChange={(event) => setPrompt(event.target.value)} placeholder="描述编辑范围内要移除、替换或添加的内容…" /></label>
        <div className="local-edit-workbench-presets"><button type="button" disabled={!ready || saving} onClick={() => resetAll(true)}>保护全图</button><button type="button" disabled={!ready || saving} onClick={() => resetAll(false)}>编辑全图</button><small>选区默认增加编辑范围；橡皮擦恢复原图保护。</small></div>
        <div className="mask-editor-actions local-edit-workbench-actions"><button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="primary-action compact" disabled={!ready || saving || coverage <= 0} onClick={() => void applyLocalEdit()}>{saving ? '正在提交…' : '应用局部编辑'}</button></div>
      </div>
    </div>
  );
}

/** Compatibility export for code that has not moved its import yet. */
export { LocalEditEditor as MaskEditor };

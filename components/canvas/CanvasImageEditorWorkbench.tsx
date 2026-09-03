"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type CSSProperties,
} from "react";
import type { CanvasDocument, CanvasImageOperation, CanvasNode } from "@/lib/canvas/types";
import {
  CANVAS_IMAGE_OPERATION_MAX_EDGE,
  clampGridLine,
  clampImageRect,
  cropRectForAspect,
  equalGridLines,
  gridRects,
  moveImageRect,
  operationLabel,
  resizeImageRect,
  resizeTargetSize,
  transformImageSize,
  type CropAspect,
  type GridLines,
  type ImageRect,
  type ImageSize,
  type OutpaintMargins,
} from "@/lib/canvas/image-operations";
import { nodeSize } from "@/lib/canvas/model";

export type CanvasImageEditorSaveMode = "new" | "replace";

export type CanvasImageEditorSaveRequest =
  | {
      operation: "outpaint";
      saveMode: CanvasImageEditorSaveMode;
      margins: OutpaintMargins;
      prompt: string;
      inputSize: ImageSize;
    }
  | {
      operation: "resize";
      saveMode: CanvasImageEditorSaveMode;
      target: ImageSize;
      inputSize: ImageSize;
    }
  | {
      operation: "crop";
      saveMode: CanvasImageEditorSaveMode;
      rect: ImageRect;
      inputSize: ImageSize;
      aspect: CropAspect;
    }
  | {
      operation: "grid";
      lines: GridLines;
      inputSize: ImageSize;
    }
  | {
      operation: "transform";
      saveMode: CanvasImageEditorSaveMode;
      rotation: 0 | 90 | 180 | 270;
      flipX: boolean;
      flipY: boolean;
      inputSize: ImageSize;
    };

type Props = {
  node: CanvasNode;
  document: CanvasDocument;
  stageRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onUpscale: () => void;
  onSave: (request: CanvasImageEditorSaveRequest) => Promise<void> | void;
};

type CanvasImageEditorOperation = Exclude<CanvasImageOperation, "grid-compose">;

type Point = { x: number; y: number };
type OutpaintDrag = { side: keyof OutpaintMargins; startX: number; startY: number; start: OutpaintMargins; scale: number };
type CropDrag = { handle: string; startX: number; startY: number; start: ImageRect; scale: number };
type GridDrag = { axis: "vertical" | "horizontal"; index: number };

const DEFAULT_OUTPAINT_PROMPT = "扩展画布，保持原图主体、风格和光影自然连续，补全新增区域";
const TABS: Array<{ id: CanvasImageEditorOperation | "upscale"; label: string; icon: string }> = [
  { id: "upscale", label: "超分", icon: "↗" },
  { id: "outpaint", label: "扩图", icon: "四" },
  { id: "resize", label: "缩放", icon: "↔" },
  { id: "crop", label: "裁切", icon: "⌗" },
  { id: "grid", label: "宫格切分", icon: "▦" },
  { id: "transform", label: "镜像-旋转", icon: "⟳" },
];
const CROP_ASPECTS: Array<{ id: CropAspect; label: string }> = [
  { id: "original", label: "原图" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "free", label: "自由" },
];

function readImageSize(url: string) {
  return new Promise<ImageSize>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error("无法读取原图尺寸"));
    image.src = url;
  });
}

function clampMargin(value: number, source: ImageSize, margins: OutpaintMargins, side: keyof OutpaintMargins) {
  const other = side === "left" || side === "right"
    ? margins.left + margins.right - margins[side]
    : margins.top + margins.bottom - margins[side];
  const sourceEdge = side === "left" || side === "right" ? source.width : source.height;
  return Math.max(0, Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE - sourceEdge - other, Math.round(value)));
}

function safeInputSize(node: CanvasNode): ImageSize {
  return {
    width: Math.max(1, Number(node.data.nativeWidth) || 1024),
    height: Math.max(1, Number(node.data.nativeHeight) || 1024),
  };
}

function formatPixels(value: number) {
  return `${Math.round(value).toLocaleString()} px`;
}

export default function CanvasImageEditorWorkbench({ node, document, stageRef, onClose, onUpscale, onSave }: Props) {
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 20, top: 100, maxHeight: 600 });
  const [operation, setOperation] = useState<CanvasImageEditorOperation>("outpaint");
  const [saveMode, setSaveMode] = useState<CanvasImageEditorSaveMode>("new");
  const [sourceSize, setSourceSize] = useState<ImageSize>(() => safeInputSize(node));
  const [sizeError, setSizeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [margins, setMargins] = useState<OutpaintMargins>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [resizeLongEdge, setResizeLongEdge] = useState(() => Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, Math.max(safeInputSize(node).width, safeInputSize(node).height)));
  const [cropAspect, setCropAspect] = useState<CropAspect>("original");
  const [cropRect, setCropRect] = useState<ImageRect>(() => cropRectForAspect(safeInputSize(node), "original"));
  const [cropDrag, setCropDrag] = useState<CropDrag | null>(null);
  const [outpaintDrag, setOutpaintDrag] = useState<OutpaintDrag | null>(null);
  const [gridCount, setGridCount] = useState(2);
  const [gridLines, setGridLines] = useState<GridLines>({ vertical: [0.5], horizontal: [0.5] });
  const [gridDrag, setGridDrag] = useState<GridDrag | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_OUTPAINT_PROMPT);

  useEffect(() => {
    let cancelled = false;
    setSourceSize(safeInputSize(node));
    setSizeError("");
    void readImageSize(String(node.data.url || "")).then((size) => {
      if (!cancelled) setSourceSize(size);
    }).catch(() => {
      if (!cancelled) setSizeError("原图尺寸读取失败，将按预览尺寸处理");
    });
    return () => { cancelled = true; };
  }, [node.data.url, node.id]);

  useEffect(() => {
    setCropRect(cropRectForAspect(sourceSize, cropAspect));
    setResizeLongEdge(Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, Math.max(sourceSize.width, sourceSize.height)));
  }, [sourceSize.width, sourceSize.height]);

  useEffect(() => {
    setCropRect((current) => cropAspect === "original" ? cropRectForAspect(sourceSize, "original") : cropAspect === "free" ? clampImageRect(current, sourceSize) : cropRectForAspect(sourceSize, cropAspect));
  }, [cropAspect, sourceSize]);

  useEffect(() => {
    setGridLines({ vertical: equalGridLines(gridCount).slice(1, -1), horizontal: equalGridLines(gridCount).slice(1, -1) });
  }, [gridCount]);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const nodeElement = target?.closest(`[data-canvas-node-id="${node.id}"]`);
      if (!workbenchRef.current?.contains(target) && !nodeElement) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (cropDrag || outpaintDrag || gridDrag) {
        setCropDrag(null);
        setOutpaintDrag(null);
        setGridDrag(null);
      } else onClose();
    };
    window.document.addEventListener("pointerdown", closeOnOutside, true);
    window.document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutside, true);
      window.document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [cropDrag, gridDrag, node.id, onClose, outpaintDrag]);

  const reposition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeElement = Array.from(stage.querySelectorAll<HTMLElement>("[data-canvas-node-id]"))
      .find((element) => element.dataset.canvasNodeId === node.id);
    const zoom = Math.max(0.12, document.camera.zoom || 1);
    const nodeRect = nodeElement?.getBoundingClientRect();
    const anchor = nodeRect
      ? { left: nodeRect.left - stageRect.left, top: nodeRect.top - stageRect.top, width: nodeRect.width, height: nodeRect.height }
      : { left: node.x * zoom + document.camera.x, top: node.y * zoom + document.camera.y, width: nodeSize(node).w * zoom, height: nodeSize(node).h * zoom };
    const viewport = { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
    const width = workbenchRef.current?.offsetWidth || Math.min(620, viewport.width - 24);
    const height = workbenchRef.current?.offsetHeight || Math.min(610, viewport.height - 24);
    const preferredLeft = Math.max(12, Math.min(viewport.width - width - 12, anchor.left + anchor.width + 16));
    const left = preferredLeft + width <= viewport.width - 12 ? preferredLeft : Math.max(12, anchor.left - width - 16);
    const preferredTop = Math.max(12, Math.min(viewport.height - height - 12, anchor.top));
    setPosition((current) => current.left === left && current.top === preferredTop ? current : { left, top: preferredTop, maxHeight: Math.max(260, viewport.height - 24) });
  }, [document.camera.x, document.camera.y, document.camera.zoom, node, stageRef]);

  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; reposition(); });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (observer && workbenchRef.current) observer.observe(workbenchRef.current);
    if (observer && stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", schedule);
    return () => { if (frame) cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", schedule); };
  }, [operation, reposition, stageRef]);

  const preview = useMemo(() => {
    if (operation === "outpaint") {
      return { width: sourceSize.width + margins.left + margins.right, height: sourceSize.height + margins.top + margins.bottom };
    }
    if (operation === "resize") return resizeTargetSize(sourceSize, resizeLongEdge);
    if (operation === "crop") return { width: cropRect.width, height: cropRect.height };
    if (operation === "transform") return transformImageSize(sourceSize, rotation);
    return sourceSize;
  }, [cropRect.height, cropRect.width, margins.bottom, margins.left, margins.right, margins.top, operation, resizeLongEdge, rotation, sourceSize]);

  const sizeLimitWarning = useMemo(() => {
    const reached = preview.width >= CANVAS_IMAGE_OPERATION_MAX_EDGE || preview.height >= CANVAS_IMAGE_OPERATION_MAX_EDGE;
    if (operation === "outpaint" && reached && Object.values(margins).some((value) => value > 0)) {
      return `已达到画布单边上限 ${CANVAS_IMAGE_OPERATION_MAX_EDGE.toLocaleString()} px，继续拖拽会自动限制`;
    }
    if (operation === "resize" && resizeLongEdge >= CANVAS_IMAGE_OPERATION_MAX_EDGE) {
      return `目标长边已限制为 ${CANVAS_IMAGE_OPERATION_MAX_EDGE.toLocaleString()} px`;
    }
    return "";
  }, [margins, operation, preview.height, preview.width, resizeLongEdge]);

  const previewScale = useMemo(() => Math.min(1, 520 / Math.max(1, preview.width), 310 / Math.max(1, preview.height)), [preview.height, preview.width]);
  const previewSize = { width: Math.max(1, Math.round(preview.width * previewScale)), height: Math.max(1, Math.round(preview.height * previewScale)) };
  const sourceDisplay = { width: Math.max(1, Math.round(sourceSize.width * previewScale)), height: Math.max(1, Math.round(sourceSize.height * previewScale)) };

  useEffect(() => {
    if (!outpaintDrag) return;
    const move = (event: PointerEvent) => {
      const delta = outpaintDrag.side === "left" || outpaintDrag.side === "right"
        ? (event.clientX - outpaintDrag.startX) / outpaintDrag.scale
        : (event.clientY - outpaintDrag.startY) / outpaintDrag.scale;
      const signed = outpaintDrag.side === "left" || outpaintDrag.side === "top" ? -delta : delta;
      setMargins((current) => ({ ...current, [outpaintDrag.side]: clampMargin(outpaintDrag.start[outpaintDrag.side] + signed, sourceSize, current, outpaintDrag.side) }));
    };
    const up = () => setOutpaintDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [outpaintDrag, sourceSize]);

  useEffect(() => {
    if (!cropDrag) return;
    const move = (event: PointerEvent) => {
      const dx = (event.clientX - cropDrag.startX) / cropDrag.scale;
      const dy = (event.clientY - cropDrag.startY) / cropDrag.scale;
      setCropRect(resizeImageRect(cropDrag.start, cropDrag.handle, dx, dy, sourceSize, cropAspect));
    };
    const up = () => setCropDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [cropAspect, cropDrag, sourceSize]);

  useEffect(() => {
    if (!gridDrag) return;
    const move = (event: PointerEvent) => {
      const viewport = window.document.querySelector<HTMLElement>("[data-image-editor-grid-preview]");
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const nextValue = gridDrag.axis === "vertical" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
      setGridLines((current) => ({
        ...current,
        [gridDrag.axis]: current[gridDrag.axis].map((value, index) => index === gridDrag.index ? clampGridLine(nextValue, index + 1, [0, ...current[gridDrag.axis], 1]) : value),
      }));
    };
    const up = () => setGridDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [document, gridDrag]);

  const beginOutpaintDrag = (event: ReactPointerEvent<HTMLButtonElement>, side: keyof OutpaintMargins) => {
    event.preventDefault();
    event.stopPropagation();
    setOutpaintDrag({ side, startX: event.clientX, startY: event.clientY, start: margins, scale: previewScale });
  };

  const beginCropDrag = (event: ReactPointerEvent<HTMLElement>, handle: string) => {
    event.preventDefault();
    event.stopPropagation();
    setCropDrag({ handle, startX: event.clientX, startY: event.clientY, start: cropRect, scale: previewScale });
  };

  const beginGridDrag = (event: ReactPointerEvent<HTMLButtonElement>, axis: "vertical" | "horizontal", index: number) => {
    event.preventDefault();
    event.stopPropagation();
    setGridDrag({ axis, index });
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (operation === "outpaint") await onSave({ operation, saveMode, margins, prompt: prompt.trim() || DEFAULT_OUTPAINT_PROMPT, inputSize: sourceSize });
      else if (operation === "resize") await onSave({ operation, saveMode, target: resizeTargetSize(sourceSize, resizeLongEdge), inputSize: sourceSize });
      else if (operation === "crop") await onSave({ operation, saveMode, rect: clampImageRect(cropRect, sourceSize, cropAspect), inputSize: sourceSize, aspect: cropAspect });
      else if (operation === "grid") await onSave({ operation, lines: gridLines, inputSize: sourceSize });
      else await onSave({ operation, saveMode, rotation, flipX, flipY, inputSize: sourceSize });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片处理失败");
    } finally {
      setBusy(false);
    }
  };

  const renderImage = (className = "", style?: CSSProperties) => (
    <img className={className} style={style} src={String(node.data.url || "")} alt={String(node.data.name || "原图")} draggable={false} />
  );

  const cropFrame = {
    left: cropRect.x * previewScale,
    top: cropRect.y * previewScale,
    width: cropRect.width * previewScale,
    height: cropRect.height * previewScale,
  };

  const gridPreviewRects = gridRects(sourceSize, gridLines);
  const operationHint = operation === "outpaint"
    ? "拖动四边扩大白色画布，保存后可在节点编辑器中生成"
    : operation === "resize"
      ? "保持原图比例，输出为指定长边分辨率"
      : operation === "crop"
        ? "拖动选框移动或拉动边角调整范围"
        : operation === "grid"
          ? "拖动分割线调整每个切片的范围"
          : "本地处理，不消耗模型额度";

  return (
    <div
      ref={workbenchRef}
      className="canvas-image-editor-workbench"
      data-canvas-wheel-isolate
      data-node-id={node.id}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="canvas-image-editor-head">
        <div>
          <b>图片编辑</b>
          <small>{operation === "grid" ? "原图保留 · 输出多个节点" : "节点内就地处理"}</small>
        </div>
        <button type="button" className="canvas-image-editor-close" onClick={onClose} aria-label="关闭图片编辑">×</button>
      </div>
      <nav className="canvas-image-editor-tabs" aria-label="图片编辑操作">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={tab.id === operation ? "active" : ""}
            onClick={() => tab.id === "upscale" ? onUpscale() : setOperation(tab.id)}
            title={tab.id === "upscale" ? "创建独立超分节点" : tab.label}
          >
            <span aria-hidden="true">{tab.icon}</span><em>{tab.label}</em>
          </button>
        ))}
      </nav>
      <div className="canvas-image-editor-body">
        <div className="canvas-image-editor-preview-card">
          <div className="canvas-image-editor-preview-label"><span>{operationLabel(operation)}</span><small>{formatPixels(sourceSize.width)} × {formatPixels(sourceSize.height)}</small></div>
          {operation === "outpaint" && (
            <div className="canvas-image-editor-preview-area outpaint" style={{ width: previewSize.width, height: previewSize.height }}>
              <div className="canvas-image-editor-outpaint-frame" style={{ width: previewSize.width, height: previewSize.height }}>
                <div className="canvas-image-editor-outpaint-source" style={{ left: margins.left * previewScale, top: margins.top * previewScale, width: sourceDisplay.width, height: sourceDisplay.height }}>{renderImage()}</div>
                {(["top", "right", "bottom", "left"] as const).map((side) => <button type="button" key={side} className={`image-editor-outpaint-handle ${side}`} onPointerDown={(event) => beginOutpaintDrag(event, side)} aria-label={`拖动${side === "top" ? "上" : side === "right" ? "右" : side === "bottom" ? "下" : "左"}边扩图`} />)}
              </div>
            </div>
          )}
          {operation === "resize" && (
            <div className="canvas-image-editor-preview-area contain" style={{ width: previewSize.width, height: previewSize.height }}>{renderImage()}</div>
          )}
          {operation === "crop" && (
            <div className="canvas-image-editor-preview-area crop" style={{ width: sourceDisplay.width, height: sourceDisplay.height }}>
              {renderImage("image-editor-preview-image")}
              <div className="image-editor-crop-dim top" style={{ height: cropFrame.top }} />
              <div className="image-editor-crop-dim bottom" style={{ top: cropFrame.top + cropFrame.height, height: Math.max(0, sourceDisplay.height - cropFrame.top - cropFrame.height) }} />
              <div className="image-editor-crop-dim left" style={{ top: cropFrame.top, width: cropFrame.left, height: cropFrame.height }} />
              <div className="image-editor-crop-dim right" style={{ left: cropFrame.left + cropFrame.width, top: cropFrame.top, width: Math.max(0, sourceDisplay.width - cropFrame.left - cropFrame.width), height: cropFrame.height }} />
              <div className="image-editor-crop-frame" style={cropFrame} onPointerDown={(event) => beginCropDrag(event, "move")}>
                <span className="image-editor-rule horizontal" /><span className="image-editor-rule horizontal two" /><span className="image-editor-rule vertical" /><span className="image-editor-rule vertical two" />
                {(["top-left", "top", "top-right", "left", "right", "bottom-left", "bottom", "bottom-right"] as const).map((handle) => <button type="button" key={handle} className={`image-editor-crop-handle ${handle}`} onPointerDown={(event) => beginCropDrag(event, handle)} aria-label={`调整裁切${handle}`} />)}
              </div>
            </div>
          )}
          {operation === "grid" && (
            <div className="canvas-image-editor-preview-area grid" data-image-editor-grid-preview style={{ width: sourceDisplay.width, height: sourceDisplay.height }}>
              {renderImage("image-editor-preview-image")}
              <div className="image-editor-grid-cells">{gridPreviewRects.map((rect, index) => <span key={`${rect.x}-${rect.y}`} style={{ left: `${(rect.x / sourceSize.width) * 100}%`, top: `${(rect.y / sourceSize.height) * 100}%`, width: `${(rect.width / sourceSize.width) * 100}%`, height: `${(rect.height / sourceSize.height) * 100}%` }}><b>{index + 1}</b></span>)}</div>
              {gridLines.vertical.map((value, index) => <button type="button" key={`v-${index}`} className="image-editor-grid-line vertical" style={{ left: `${value * 100}%` }} onPointerDown={(event) => beginGridDrag(event, "vertical", index)} aria-label={`拖动第${index + 1}条竖向分割线`} />)}
              {gridLines.horizontal.map((value, index) => <button type="button" key={`h-${index}`} className="image-editor-grid-line horizontal" style={{ top: `${value * 100}%` }} onPointerDown={(event) => beginGridDrag(event, "horizontal", index)} aria-label={`拖动第${index + 1}条横向分割线`} />)}
            </div>
          )}
          {operation === "transform" && (
            <div className="canvas-image-editor-preview-area transform" style={{ width: previewSize.width, height: previewSize.height }}>{renderImage("image-editor-transform-image", { transform: `rotate(${rotation}deg) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` })}</div>
          )}
          <div className="canvas-image-editor-preview-caption"><span>{operationHint}</span><b>{operation === "grid" ? `${gridCount} × ${gridCount} · ${gridPreviewRects.length} 张` : `${formatPixels(preview.width)} × ${formatPixels(preview.height)}`}</b></div>
        </div>

        {operation === "outpaint" && <div className="canvas-image-editor-controls">
          <div className="canvas-image-editor-section-title"><b>扩展范围</b><small>新增区域为白色画布</small></div>
          <div className="canvas-image-editor-margin-grid">{(["top", "right", "bottom", "left"] as const).map((side) => <label key={side}><span>{side === "top" ? "上" : side === "right" ? "右" : side === "bottom" ? "下" : "左"}</span><input type="number" min={0} max={CANVAS_IMAGE_OPERATION_MAX_EDGE} value={margins[side]} onChange={(event) => setMargins((current) => ({ ...current, [side]: clampMargin(Number(event.target.value), sourceSize, current, side) }))} /><em>px</em></label>)}</div>
          <label className="canvas-image-editor-prompt"><span>默认扩图提示词</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} /></label>
        </div>}
        {operation === "resize" && <div className="canvas-image-editor-controls">
          <div className="canvas-image-editor-section-title"><b>目标长边</b><strong>{formatPixels(resizeLongEdge)}</strong></div>
          <input className="canvas-image-editor-range" type="range" min={256} max={CANVAS_IMAGE_OPERATION_MAX_EDGE} step={1} value={resizeLongEdge} onChange={(event) => setResizeLongEdge(Number(event.target.value))} aria-label="目标长边像素" />
          <div className="canvas-image-editor-range-scale"><span>256</span><span>2K</span><span>4K / 最大</span></div>
          <div className="canvas-image-editor-preset-row">{[1024, 2048, 4096].map((value) => <button type="button" key={value} className={resizeLongEdge === value ? "active" : ""} onClick={() => setResizeLongEdge(Math.min(CANVAS_IMAGE_OPERATION_MAX_EDGE, value))}>{value === 1024 ? "1K" : value === 2048 ? "2K" : "4K"}</button>)}</div>
          <div className="canvas-image-editor-readout"><span>原图<strong>{formatPixels(Math.max(sourceSize.width, sourceSize.height))}</strong></span><i>→</i><span>输出<strong>{formatPixels(Math.max(preview.width, preview.height))}</strong></span></div>
        </div>}
        {operation === "crop" && <div className="canvas-image-editor-controls">
          <div className="canvas-image-editor-section-title"><b>裁切比例</b><small>可继续拖动范围框</small></div>
          <div className="canvas-image-editor-preset-row crop-presets">{CROP_ASPECTS.map((item) => <button type="button" key={item.id} className={cropAspect === item.id ? "active" : ""} onClick={() => setCropAspect(item.id)}>{item.label}</button>)}</div>
          <div className="canvas-image-editor-readout"><span>裁切范围<strong>{formatPixels(cropRect.width)} × {formatPixels(cropRect.height)}</strong></span><i>·</i><span>位置<strong>{Math.round(cropRect.x)}, {Math.round(cropRect.y)}</strong></span></div>
        </div>}
        {operation === "grid" && <div className="canvas-image-editor-controls">
          <div className="canvas-image-editor-section-title"><b>宫格预设</b><small>分割线可直接拖动</small></div>
          <div className="canvas-image-editor-preset-row grid-presets">{[2, 3, 4, 5].map((value) => <button type="button" key={value} className={gridCount === value ? "active" : ""} onClick={() => setGridCount(value)}>{value} × {value}</button>)}</div>
          <div className="canvas-image-editor-readout"><span>输出切片<strong>{gridPreviewRects.length} 张</strong></span><i>·</i><span>原图保留<strong>自动成组</strong></span></div>
        </div>}
        {operation === "transform" && <div className="canvas-image-editor-controls">
          <div className="canvas-image-editor-section-title"><b>镜像-旋转</b><small>实时预览，保持原图清晰度</small></div>
          <div className="canvas-image-editor-transform-row"><button type="button" onClick={() => setRotation((value) => ((value + 270) % 360) as 0 | 90 | 180 | 270)}>↶ 左转</button><button type="button" onClick={() => setRotation((value) => ((value + 90) % 360) as 0 | 90 | 180 | 270)}>↷ 右转</button><span>{rotation}°</span><button type="button" className={flipX ? "active" : ""} onClick={() => setFlipX((value) => !value)}>↔ 水平</button><button type="button" className={flipY ? "active" : ""} onClick={() => setFlipY((value) => !value)}>↕ 垂直</button></div>
        </div>}
        {(sizeError || sizeLimitWarning) && <small className="canvas-image-editor-warning">{sizeError || sizeLimitWarning}</small>}
        {error && <div className="canvas-image-editor-error">{error}</div>}
      </div>
      <div className="canvas-image-editor-footer">
        {operation !== "grid" ? <div className="canvas-image-editor-save-mode" role="group" aria-label="保存方式"><button type="button" className={saveMode === "new" ? "active" : ""} onClick={() => setSaveMode("new")}>生成新节点</button><button type="button" className={saveMode === "replace" ? "active" : ""} onClick={() => setSaveMode("replace")}>覆盖当前</button></div> : <span className="canvas-image-editor-grid-note">原图保留 · 生成并自动成组</span>}
        <div className="canvas-image-editor-footer-actions"><button type="button" className="canvas-image-editor-cancel" onClick={onClose}>取消</button><button type="button" className="canvas-image-editor-save" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : operation === "grid" ? "切分并成组" : saveMode === "replace" ? "覆盖当前节点" : "生成新节点"}</button></div>
      </div>
    </div>
  );
}

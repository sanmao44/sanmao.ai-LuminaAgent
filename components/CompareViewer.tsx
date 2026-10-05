"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { GalleryItem } from "@/lib/client-history";
import { formatTime } from "@/lib/generation-log-presentation";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type CompareSource = { item: GalleryItem; kind: "reference" | "parent"; label: string };
type CompareViewerProps = { item: GalleryItem; source?: CompareSource | null; parent: GalleryItem; Icon: ComponentType<{ name: string; size?: number }>; onClose: () => void };
type Size = { width: number; height: number };
type ViewportSizes = { stage: Size; before: Size; current: Size };

function containSize(image: Size, viewport: Size): Size {
  if (!viewport.width || !viewport.height) return { width: 0, height: 0 };
  if (!image.width || !image.height) return { ...viewport };
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: Math.max(1, image.width * scale), height: Math.max(1, image.height * scale) };
}

export default function CompareViewer({ item, source, parent, Icon, onClose }: CompareViewerProps) {
  useBodyScrollLock(true);
  const [mode, setMode] = useState<"slider" | "side-by-side">("slider");
  const [position, setPosition] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const beforePaneRef = useRef<HTMLDivElement>(null);
  const currentPaneRef = useRef<HTMLDivElement>(null);
  const sliderDragRef = useRef(false);
  const panDragRef = useRef({ active: false, x: 0, y: 0, panX: 0, panY: 0 });
  const [imageSizes, setImageSizes] = useState({ before: { width: 0, height: 0 }, current: { width: 0, height: 0 } });
  const [viewportSizes, setViewportSizes] = useState<ViewportSizes>({ stage: { width: 0, height: 0 }, before: { width: 0, height: 0 }, current: { width: 0, height: 0 } });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const readSize = (element: HTMLDivElement | null, fallback: Size) => element ? { width: element.clientWidth, height: element.clientHeight } : fallback;
    const measure = () => {
      const stageSize = { width: stage.clientWidth, height: stage.clientHeight };
      const next = { stage: stageSize, before: mode === "slider" ? stageSize : readSize(beforePaneRef.current, stageSize), current: mode === "slider" ? stageSize : readSize(currentPaneRef.current, stageSize) };
      setViewportSizes((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    if (beforePaneRef.current) observer?.observe(beforePaneRef.current);
    if (currentPaneRef.current) observer?.observe(currentPaneRef.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [mode]);
  const beforeViewport = mode === "slider" ? viewportSizes.stage : viewportSizes.before;
  const currentViewport = mode === "slider" ? viewportSizes.stage : viewportSizes.current;
  const frameSizes = useMemo(() => ({ before: containSize(imageSizes.before, beforeViewport), current: containSize(imageSizes.current, currentViewport) }), [beforeViewport, currentViewport, imageSizes]);
  const panLimits = useMemo(() => {
    const limits = [{ frame: frameSizes.before, viewport: beforeViewport }, { frame: frameSizes.current, viewport: currentViewport }];
    return { x: Math.max(0, Math.min(...limits.map(({ frame, viewport }) => Math.max(0, (frame.width * zoom - viewport.width) / 2)))), y: Math.max(0, Math.min(...limits.map(({ frame, viewport }) => Math.max(0, (frame.height * zoom - viewport.height) / 2)))) };
  }, [beforeViewport, currentViewport, frameSizes, zoom]);
  const clampPan = (next: { x: number; y: number }) => ({ x: Math.min(panLimits.x, Math.max(-panLimits.x, next.x)), y: Math.min(panLimits.y, Math.max(-panLimits.y, next.y)) });
  useEffect(() => { setPan((current) => clampPan(current)); }, [panLimits.x, panLimits.y]);
  const handleImageLoad = (side: "before" | "current", event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;
    setImageSizes((current) => current[side].width === naturalWidth && current[side].height === naturalHeight ? current : { ...current, [side]: { width: naturalWidth, height: naturalHeight } });
  };
  const updatePosition = (clientX: number) => { const stage = stageRef.current; if (!stage) return; const rect = stage.getBoundingClientRect(); setPosition(Math.min(100, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width) * 100))); };
  const adjustZoom = (next: number) => { const value = Math.min(8, Math.max(1, Number(next.toFixed(2)))); setZoom(value); if (value === 1) setPan({ x: 0, y: 0 }); };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => { event.preventDefault(); adjustZoom(zoom + (event.deltaY > 0 ? -0.1 : 0.1)); };
  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0 || mode === "slider" && (event.target as HTMLElement)?.closest?.(".compare-divider")) return; event.preventDefault(); if (zoom <= 1) return; event.currentTarget.setPointerCapture(event.pointerId); panDragRef.current = { active: true, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; setDragging(true); };
  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (sliderDragRef.current) updatePosition(event.clientX); const drag = panDragRef.current; if (drag.active) setPan(clampPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y })); };
  const handleStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => { panDragRef.current.active = false; sliderDragRef.current = false; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const startSliderDrag = (event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); sliderDragRef.current = true; updatePosition(event.clientX); };
  const stopSliderDrag = (event: ReactPointerEvent<HTMLButtonElement>) => { sliderDragRef.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const handleDividerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); if (event.key === "Home") return setPosition(0); if (event.key === "End") return setPosition(100); setPosition((current) => Math.min(100, Math.max(0, current + (event.key === "ArrowRight" ? 5 : -5)))); };
  const getFrameStyle = (size: Size) => ({ width: Math.max(1, size.width), height: Math.max(1, size.height), left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)`, transform: `translate(-50%, -50%) scale(${zoom})` });
  const comparisonSource = source || { item: parent, kind: parent.id.startsWith("reference-") ? "reference" as const : "parent" as const, label: parent.id.startsWith("reference-") ? "参考图" : "前一版本" };
  const beforeLabel = comparisonSource.label;
  const heading = comparisonSource.kind === "reference" ? "当前版本与参考图" : "当前版本与直接上一版本";
  const before = comparisonSource.item;
  const image = (url: string, alt: string, side: "before" | "current") => <div className="compare-image-frame" style={getFrameStyle(frameSizes[side])}><img draggable={false} onDragStart={(event) => event.preventDefault()} src={url} alt={alt} onLoad={(event) => handleImageLoad(side, event)} /></div>;
  return <div className="compare-backdrop" onWheel={(event) => event.preventDefault()} onClick={onClose}><section className="compare-viewer" onClick={(event) => event.stopPropagation()}>
    <header className="compare-top"><div className="compare-heading"><span>版本对比</span><strong>{heading}</strong><small>{item.modelName || "图片模型"} · {formatTime(item.createdAt)}</small></div><div className="compare-top-actions"><div className="compare-mode-switch" role="group" aria-label="对比模式"><button type="button" className={mode === "slider" ? "active" : ""} onClick={() => setMode("slider")}>滑块</button><button type="button" className={mode === "side-by-side" ? "active" : ""} onClick={() => setMode("side-by-side")}>并排</button></div><div className="zoom-controls"><button type="button" title="缩小" onClick={() => adjustZoom(zoom - 0.1)}><Icon name="zoomOut" size={16} /></button><span className="zoom-readout">{Math.round(zoom * 100)}%</span><button type="button" className="zoom-reset" onClick={resetView}>原比例</button><button type="button" title="放大" onClick={() => adjustZoom(zoom + 0.1)}><Icon name="zoomIn" size={16} /></button></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭版本对比"><Icon name="close" /></button></div></header>
    <div className="compare-stage-wrap"><div className={`compare-stage ${mode === "slider" ? "slider-mode" : "side-by-side-mode"} ${zoom > 1 ? "can-drag" : ""} ${dragging ? "dragging" : ""}`} ref={stageRef} onWheel={handleWheel} onPointerDown={handleStagePointerDown} onPointerMove={handleStagePointerMove} onPointerUp={handleStagePointerUp} onPointerCancel={handleStagePointerUp} onLostPointerCapture={handleStagePointerUp}>
      {mode === "slider" ? <><div className="compare-image-layer">{image(before.url, beforeLabel, "before")}</div><div className="compare-image-layer compare-current-layer" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>{image(item.url, "当前版本图片", "current")}</div><button type="button" className="compare-divider" style={{ left: `${position}%` }} role="slider" aria-label="调整前后版本分界线" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position)} onPointerDown={startSliderDrag} onPointerMove={(event) => { if (sliderDragRef.current) updatePosition(event.clientX); }} onPointerUp={stopSliderDrag} onPointerCancel={stopSliderDrag} onKeyDown={handleDividerKeyDown}><span /></button><span className="compare-label compare-label-before">{beforeLabel}</span><span className="compare-label compare-label-after">当前版本</span></> : <div className="compare-side-grid"><div className="compare-side-pane" ref={beforePaneRef}><span className="compare-label">{beforeLabel}</span>{image(before.url, beforeLabel, "before")}</div><div className="compare-side-pane" ref={currentPaneRef}><span className="compare-label">当前版本</span>{image(item.url, "当前版本图片", "current")}</div></div>}
      <div className="wheel-tip">滚轮缩放{zoom > 1 ? " · 按住图片拖动查看" : ""}</div>
    </div></div>
    <footer className="compare-info"><div><span>{beforeLabel}</span><strong>{before.prompt || "未保存提示词"}</strong></div><div><span>当前版本</span><strong>{item.prompt || "未保存提示词"}</strong></div></footer>
  </section></div>;
}

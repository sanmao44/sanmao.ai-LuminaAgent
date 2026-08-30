"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import { requestPromptOptimization, runReversePrompt } from "@/lib/creation/agent";
import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from "@/lib/creation/settings";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";

export type MediaViewerReference = {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
};

export type MediaViewerItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
  prompt?: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
};

export type MediaViewerSurface = "workspace" | "canvas";

type MediaViewerSide = "item" | "reference";
type MediaViewerSize = { width: number; height: number };
type MediaViewerViewport = { width: number; height: number };

function containMediaSize(media: MediaViewerSize, viewport: MediaViewerViewport) {
  if (!viewport.width || !viewport.height) return { width: 0, height: 0 };
  if (!media.width || !media.height) {
    return {
      width: Math.max(1, viewport.width - 40),
      height: Math.max(1, viewport.height - 40),
    };
  }
  const scale = Math.min(
    Math.max(1, viewport.width - 40) / media.width,
    Math.max(1, viewport.height - 40) / media.height,
  );
  return {
    width: Math.max(1, Math.round(media.width * scale)),
    height: Math.max(1, Math.round(media.height * scale)),
  };
}

export default function MediaViewer({
  item,
  references,
  surface = "workspace",
  initialCompare = false,
  parameters,
  runtime,
  model,
  agentAvailable,
  onClose,
  onNavigate,
  onPromptSave,
  onParametersChange,
  onEdit,
  onMask,
  onUpscale,
  onContinue,
  onReuse,
  onUseAsReference,
  onAddToAssets,
  onDelete,
  onDownload,
  onWriteResult,
  onCreateTextNode,
  onAngle,
  onNotify,
}: {
  item: MediaViewerItem;
  references: MediaViewerReference[];
  surface?: MediaViewerSurface;
  initialCompare?: boolean;
  parameters?: ImageCreationSettings | VideoCreationSettings;
  runtime: unknown;
  model?: string;
  agentAvailable: boolean;
  onClose: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  onPromptSave?: (value: string) => void;
  onParametersChange?: (settings: CreationSettings) => void;
  onEdit?: () => void;
  onMask?: () => void;
  onAngle?: () => void;
  onUpscale?: () => void;
  onContinue?: () => void;
  onReuse?: () => void;
  onUseAsReference?: () => void;
  onAddToAssets?: () => void;
  onDelete?: () => void;
  onDownload?: (variant: "original" | "share") => void;
  onWriteResult?: (value: string) => void;
  onCreateTextNode?: (value: string) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const beforePaneRef = useRef<HTMLDivElement | null>(null);
  const currentPaneRef = useRef<HTMLDivElement | null>(null);
  const [compare, setCompare] = useState(initialCompare);
  const [compareMode, setCompareMode] = useState<"slider" | "side-by-side">("slider");
  const [comparePosition, setComparePosition] = useState(50);
  const [selectedReferenceId, setSelectedReferenceId] = useState(references[0]?.id || "");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [mediaSizes, setMediaSizes] = useState<Record<MediaViewerSide, MediaViewerSize>>({
    item: { width: 0, height: 0 },
    reference: { width: 0, height: 0 },
  });
  const [viewportSizes, setViewportSizes] = useState<{
    stage: MediaViewerViewport;
    before: MediaViewerViewport;
    current: MediaViewerViewport;
  }>({
    stage: { width: 0, height: 0 },
    before: { width: 0, height: 0 },
    current: { width: 0, height: 0 },
  });
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"reverse" | "optimize" | null>(null);
  const [showParameters, setShowParameters] = useState(false);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const pointerStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const sliderPointerId = useRef<number | null>(null);

  const sourcePrompt = item.prompt || "";
  const currentPrompt = promptDraft ?? sourcePrompt;
  const selectedReference = references.find((reference) => reference.id === selectedReferenceId) || references[0];
  const canCompare = item.kind === "image" && selectedReference?.kind === "image" && Boolean(selectedReference.url);
  const referenceSignature = references.map((reference) => `${reference.id}:${reference.url}`).join("|");
  const showComparison = compare && canCompare && Boolean(selectedReference);

  useEffect(() => {
    setCompare(initialCompare);
    setCompareMode("slider");
    setComparePosition(50);
    setSelectedReferenceId(references[0]?.id || "");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMediaSizes({
      item: { width: 0, height: 0 },
      reference: { width: 0, height: 0 },
    });
    setResult(null);
    setShowParameters(false);
    setPromptDraft(null);
  }, [initialCompare, item.id, referenceSignature]);

  useEffect(() => {
    sliderPointerId.current = null;
    pointerStart.current = null;
    setDragging(false);
    setPan({ x: 0, y: 0 });
  }, [compare, compareMode, selectedReferenceId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const readSize = (element: HTMLElement | null, fallback: MediaViewerViewport) =>
      element
        ? { width: element.clientWidth, height: element.clientHeight }
        : fallback;
    const measure = () => {
      const stageSize = { width: stage.clientWidth, height: stage.clientHeight };
      const sideBySide = showComparison && compareMode === "side-by-side";
      const fallbackPane = {
        width: Math.max(1, (stageSize.width - 1) / 2),
        height: stageSize.height,
      };
      const next = {
        stage: stageSize,
        before: sideBySide ? readSize(beforePaneRef.current, fallbackPane) : stageSize,
        current: sideBySide ? readSize(currentPaneRef.current, fallbackPane) : stageSize,
      };
      setViewportSizes((current) =>
        current.stage.width === next.stage.width &&
        current.stage.height === next.stage.height &&
        current.before.width === next.before.width &&
        current.before.height === next.before.height &&
        current.current.width === next.current.width &&
        current.current.height === next.current.height
          ? current
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    if (beforePaneRef.current) observer?.observe(beforePaneRef.current);
    if (currentPaneRef.current) observer?.observe(currentPaneRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [compareMode, showComparison]);

  const beforeViewport = showComparison && compareMode === "side-by-side"
    ? viewportSizes.before
    : viewportSizes.stage;
  const currentViewport = showComparison && compareMode === "side-by-side"
    ? viewportSizes.current
    : viewportSizes.stage;
  const frameSizes = useMemo(
    () => ({
      reference: containMediaSize(mediaSizes.reference, beforeViewport),
      item: containMediaSize(mediaSizes.item, currentViewport),
    }),
    [beforeViewport, currentViewport, mediaSizes],
  );
  const getPanLimits = (nextZoom: number) => {
    const limits = [
      { frame: frameSizes.item, viewport: currentViewport },
      ...(showComparison
        ? [{ frame: frameSizes.reference, viewport: beforeViewport }]
        : []),
    ];
    return {
      x: Math.max(0, Math.min(...limits.map(({ frame, viewport }) => Math.max(0, (frame.width * nextZoom - viewport.width) / 2)))),
      y: Math.max(0, Math.min(...limits.map(({ frame, viewport }) => Math.max(0, (frame.height * nextZoom - viewport.height) / 2)))),
    };
  };

  const panLimits = useMemo(
    () => getPanLimits(zoom),
    [beforeViewport, currentViewport, frameSizes, showComparison, zoom],
  );

  const clampPan = (value: { x: number; y: number }, limits = panLimits) => ({
    x: Math.min(limits.x, Math.max(-limits.x, value.x)),
    y: Math.min(limits.y, Math.max(-limits.y, value.y)),
  });

  useEffect(() => {
    setPan((current) => clampPan(current));
  }, [panLimits.x, panLimits.y]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".select-menu-popover,.model-picker-panel,.model-picker-dialog-backdrop")) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && onNavigate) {
        if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
        event.preventDefault();
        onNavigate(-1);
      } else if (event.key === "ArrowRight" && onNavigate) {
        if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
        event.preventDefault();
        onNavigate(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onNavigate]);

  const resetView = () => {
    pointerStart.current = null;
    sliderPointerId.current = null;
    setDragging(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const updateZoom = (next: number, focus?: { x: number; y: number }) => {
    const previous = zoom;
    const value = Math.max(1, Math.min(8, Number(next.toFixed(2))));
    setZoom(value);
    if (value <= 1) {
      pointerStart.current = null;
      setDragging(false);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (focus && rect && previous > 0) {
      const pointerX = focus.x - rect.left - rect.width / 2;
      const pointerY = focus.y - rect.top - rect.height / 2;
      const nextPan = {
        x: pointerX - (pointerX - pan.x) * (value / previous),
        y: pointerY - (pointerY - pan.y) * (value / previous),
      };
      setPan(clampPan(nextPan, getPanLimits(value)));
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1), { x: event.clientX, y: event.clientY });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("button, input, textarea, select, option, video, .media-viewer-divider")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sliderPointerId.current === event.pointerId) {
      updateComparePosition(event.clientX);
      return;
    }
    const drag = pointerStart.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPan(clampPan({
      x: drag.panX + event.clientX - drag.x,
      y: drag.panY + event.clientY - drag.y,
    }));
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sliderPointerId.current === event.pointerId) sliderPointerId.current = null;
    if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const handleLostPointerCapture = () => {
    sliderPointerId.current = null;
    pointerStart.current = null;
    setDragging(false);
  };

  const handleMediaLoad = (side: MediaViewerSide, element: HTMLImageElement | HTMLVideoElement) => {
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
    if (!width || !height) return;
    setMediaSizes((current) =>
      current[side].width === width && current[side].height === height
        ? current
        : { ...current, [side]: { width, height } },
    );
  };

  const updateComparePosition = (clientX: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setComparePosition(Math.min(100, Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * 100)));
  };

  const startSliderDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(event.pointerId);
    sliderPointerId.current = event.pointerId;
    updateComparePosition(event.clientX);
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return setComparePosition(0);
    if (event.key === "End") return setComparePosition(100);
    setComparePosition((current) => Math.min(100, Math.max(0, current + (event.key === "ArrowRight" ? 5 : -5))));
  };

  const mediaFrameStyle = (size: MediaViewerSize) => ({
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    left: `calc(50% + ${pan.x}px)`,
    top: `calc(50% + ${pan.y}px)`,
    transform: `translate(-50%, -50%) scale(${zoom})`,
  });

  const mediaStyle = {
    width: "100%",
    height: "100%",
    objectFit: "contain" as const,
  };

  const runReverse = async () => {
    if (item.kind !== "image") return;
    if (!agentAvailable) return onNotify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    setBusy(true);
    setBusyAction("reverse");
    try {
      const value = await runReversePrompt(
        [{ url: item.url, name: item.name }, ...references.map((reference) => ({ url: reference.url, name: reference.name }))],
        model,
      );
      setResult(value);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "反推提示词失败", "error");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const runOptimize = async () => {
    if (!agentAvailable) return onNotify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    if (!sourcePrompt.trim()) return onNotify("当前媒体没有可优化的原始提示词", "error");
    setBusy(true);
    setBusyAction("optimize");
    try {
      const value = await requestPromptOptimization(
        sourcePrompt,
        references.map((reference) => ({ url: reference.url, name: reference.name })),
        model,
      );
      setResult(value);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "AI 优化失败", "error");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const writeResultToPrompt = () => {
    if (!result) return;
    // Keep the result visible here too; the canvas parent may close this viewer
    // after copying it into the node editor.
    setPromptDraft(result);
    onWriteResult?.(result);
  };

  const savePrompt = () => {
    if (!onPromptSave || !currentPrompt.trim() || currentPrompt === sourcePrompt) return;
    onPromptSave(currentPrompt);
    setPromptDraft(null);
    onNotify("提示词已保存");
  };

  const download = (variant: "original" | "share") => {
    if (onDownload) return onDownload(variant);
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.download = `${item.name || "SANMAO素材"}-${variant === "share" ? "分享版" : "原图"}.${item.kind === "video" ? "mp4" : "png"}`;
    anchor.click();
  };

  return (
    <div
      className="canvas-modal-backdrop media-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name || "素材"}预览`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="canvas-lightbox canvas-media-viewer media-viewer-shared">
        <header>
          <div>
            <b>{item.name || "素材预览"}</b>
            <small>{item.width && item.height ? `${item.width} × ${item.height}` : "画布媒体预览"}</small>
          </div>
          <div className="media-viewer-header-actions">
            <div className="canvas-media-zoom-controls" aria-label="预览缩放">
              <button type="button" onClick={() => updateZoom(zoom - 0.1)} title="缩小">−</button>
              <button type="button" className="zoom-readout" onClick={resetView} title="恢复原比例">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => updateZoom(zoom + 0.1)} title="放大">＋</button>
            </div>
            {onNavigate && <span className="media-viewer-nav-hint">← / → 切换</span>}
            <button type="button" className={`media-viewer-header-button media-viewer-toggle-button ${compare ? "active" : ""}`} onClick={() => setCompare((value) => !value)} disabled={!canCompare}>
              <span className="media-viewer-button-icon" aria-hidden="true">{compare ? "◉" : "◌"}</span>
              <span>{compare ? "单图预览" : "前后对比"}</span>
            </button>
            {canCompare && compare && (
              <div className="media-viewer-compare-mode" role="group" aria-label="对比模式">
                <button type="button" className={compareMode === "slider" ? "active" : ""} onClick={() => setCompareMode("slider")}><span aria-hidden="true">↔</span>滑块</button>
                <button type="button" className={compareMode === "side-by-side" ? "active" : ""} onClick={() => setCompareMode("side-by-side")}><span aria-hidden="true">▥</span>并排</button>
              </div>
            )}
            {parameters && <button type="button" className={`media-viewer-header-button media-viewer-settings-button ${showParameters ? "active" : ""}`} onClick={() => setShowParameters((value) => !value)}><span className="media-viewer-button-icon" aria-hidden="true">⚙</span><span>参数调整</span></button>}
            <div className="media-viewer-download-group" role="group" aria-label="下载">
              <button type="button" className="media-viewer-download-button original" onClick={() => download("original")}><span className="media-viewer-button-icon" aria-hidden="true">↓</span><span>原图</span></button>
              <button type="button" className="media-viewer-download-button share" onClick={() => download("share")} disabled={item.kind !== "image"}><span className="media-viewer-button-icon" aria-hidden="true">⇩</span><span>分享版</span></button>
            </div>
            <button type="button" className="media-viewer-close-button" onClick={onClose} aria-label="关闭预览"><span aria-hidden="true">×</span></button>
          </div>
        </header>

        <div
          ref={stageRef}
          className={`canvas-lightbox-stage media-viewer-stage ${zoom > 1 ? "can-pan" : ""} ${showComparison ? "compare" : ""} ${showComparison && compareMode === "slider" ? "slider" : ""} ${showComparison && compareMode === "side-by-side" ? "side-by-side" : ""} ${dragging ? "dragging" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onLostPointerCapture={handleLostPointerCapture}
          onDoubleClick={resetView}
        >
          {showComparison && compareMode === "slider" ? (
            <>
              <div className="media-viewer-compare-layer">
                <div className="media-viewer-image-frame" style={mediaFrameStyle(frameSizes.reference)}>
                  <img className="media-viewer-copyable-image" draggable={false} src={selectedReference.url} alt={selectedReference.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("reference", event.currentTarget)} />
                </div>
              </div>
              <div className="media-viewer-compare-layer media-viewer-current-layer" style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}>
                <div className="media-viewer-image-frame" style={mediaFrameStyle(frameSizes.item)}>
                  <img className="media-viewer-copyable-image" draggable={false} src={item.url} alt={item.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("item", event.currentTarget)} />
                </div>
              </div>
              <button
                type="button"
                className="media-viewer-divider"
                style={{ left: `${comparePosition}%` }}
                role="slider"
                aria-label="调整前后版本分界线"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(comparePosition)}
                onPointerDown={startSliderDrag}
                onKeyDown={handleDividerKeyDown}
              >
                <span />
              </button>
              <span className="media-viewer-compare-label before">{selectedReference.name}</span>
              <span className="media-viewer-compare-label after">生成结果</span>
            </>
          ) : showComparison ? (
            <div className="media-viewer-side-grid">
              <div className="media-viewer-side-pane" ref={beforePaneRef}>
                <span className="media-viewer-compare-label">{selectedReference.name}</span>
                <div className="media-viewer-image-frame" style={mediaFrameStyle(frameSizes.reference)}>
                  <img className="media-viewer-copyable-image" draggable={false} src={selectedReference.url} alt={selectedReference.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("reference", event.currentTarget)} />
                </div>
              </div>
              <div className="media-viewer-side-pane" ref={currentPaneRef}>
                <span className="media-viewer-compare-label">生成结果</span>
                <div className="media-viewer-image-frame" style={mediaFrameStyle(frameSizes.item)}>
                  <img className="media-viewer-copyable-image" draggable={false} src={item.url} alt={item.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("item", event.currentTarget)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="media-viewer-single-layer">
              <div className="media-viewer-image-frame" style={mediaFrameStyle(frameSizes.item)}>
                {item.kind === "video" ? <video src={item.url} controls playsInline style={mediaStyle} onLoadedMetadata={(event) => handleMediaLoad("item", event.currentTarget)} /> : <img className="media-viewer-copyable-image" draggable={false} src={item.url} alt={item.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("item", event.currentTarget)} />}
              </div>
            </div>
          )}
          <span className="media-viewer-wheel-tip">滚轮缩放 · 双击复位{zoom > 1 ? " · 拖动查看" : ""} · 点击百分比恢复完整画面</span>
        </div>

        {references.length > 0 && (
          <section className="media-viewer-reference-panel">
            <div className="media-viewer-reference-head"><b>参考图 · {references.length} 张</b><small>点击切换对比对象</small></div>
            <div className="media-viewer-reference-list">
              {references.map((reference, index) => (
                <button type="button" className={reference.id === selectedReference?.id ? "active" : ""} key={reference.id} onClick={() => { setSelectedReferenceId(reference.id); if (reference.kind === "image") setCompare(true); }}>
                  {reference.kind === "video" ? <video src={reference.url} muted playsInline /> : <img src={reference.url} alt={reference.name} />}
                  <span>图 {index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="canvas-media-viewer-editing">
          <label><span>提示词</span><textarea value={currentPrompt} onChange={(event) => setPromptDraft(event.target.value)} placeholder="当前节点没有保存提示词" /></label>
          <button type="button" disabled={!onPromptSave || !currentPrompt.trim() || currentPrompt === sourcePrompt} onClick={savePrompt}>保存提示词</button>
        </div>

        {showParameters && parameters && onParametersChange && (
          <section className="canvas-media-parameters">
            <header><b>生成参数</b><small>{surface === "canvas" && item.kind === "image" ? "修改后从当前图片生成右侧新图，原图不会被覆盖" : "修改后用于生成新分支，原图不会被覆盖"}</small></header>
            <CreationParameterEditor settings={parameters} runtime={runtime as never} portalZIndex={CANVAS_Z_INDEX.modalPopover} dialogPortalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onParametersChange} />
          </section>
        )}

        <div className={`canvas-media-viewer-actions media-viewer-actions-shared media-viewer-surface-${surface}`}>
          {item.kind === "image" && <button type="button" disabled={busy || !agentAvailable} aria-busy={busyAction === "reverse"} onClick={() => void runReverse()}>{busyAction === "reverse" ? "⌁ 反推中…" : "⌁ 反推提示词"}</button>}
          <button type="button" disabled={busy || !agentAvailable} aria-busy={busyAction === "optimize"} onClick={() => void runOptimize()}>{busyAction === "optimize" ? "✦ 优化中…" : "✦ AI 优化"}</button>
          {surface === "canvas" ? (
            <>
              {onEdit && <button type="button" onClick={onEdit}>✎ 编辑节点</button>}
              {onMask && item.kind === "image" && <button type="button" onClick={onMask}>◌ 蒙版</button>}
            </>
          ) : onEdit ? <button type="button" onClick={onEdit}>✎ 修改 / 蒙版</button> : null}
          {onAngle && item.kind === "image" && <button type="button" onClick={onAngle}>◌ 调整角度</button>}
          {onUpscale && item.kind === "image" && <button type="button" onClick={onUpscale}>↗ 超分</button>}
          {onContinue && <button type="button" onClick={onContinue}>{item.kind === "video" ? "▶ 继续生成 / 变体" : "▶ 继续生成"}</button>}
          {onReuse && <button type="button" className="primary" onClick={onReuse}>⧉ 用此参数继续生成</button>}
          {onUseAsReference && <button type="button" onClick={onUseAsReference}>⌁ 作为参考图</button>}
          {onAddToAssets && <button type="button" onClick={onAddToAssets}>＋ 加入资产库</button>}
          {onDelete && <button type="button" className="danger" onClick={onDelete}>⌫ 删除</button>}
        </div>

        {!agentAvailable && <div className="canvas-media-viewer-note">反推提示词与 AI 优化已暂停：请先在主界面模型库启用一个对话模型。</div>}
        {result && (
          <section className="canvas-media-result-panel">
            <header><b>AI 结果（未覆盖原文）</b><button type="button" onClick={() => setResult(null)}>×</button></header>
            <p>{result}</p>
            <footer>
              {onWriteResult && <button type="button" onClick={writeResultToPrompt}>写入当前提示词</button>}
              {onCreateTextNode && <button type="button" onClick={() => onCreateTextNode(result)}>创建文本节点</button>}
              <button type="button" onClick={() => void navigator.clipboard?.writeText(result)}>复制结果</button>
              <button type="button" onClick={() => setResult(null)}>放弃</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}

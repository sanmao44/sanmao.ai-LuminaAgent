"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from "@/lib/creation/settings";

export type MediaViewerReference = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  name: string;
};

export type MediaViewerItem = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  name: string;
  prompt?: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
  versionInfo?: ImageVersionInfo;
};

export type ImageVersionInfo = {
  sourceNode?: string;
  provider?: string;
  model?: string;
  dimensions?: string;
  createdAt?: number;
  generationDurationMs?: number;
  prompt?: string;
  parameters?: Array<{ label: string; value: string }>;
  status?: string;
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

function formatVersionTime(value?: number) {
  if (!value || !Number.isFinite(value)) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatGenerationDuration(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "未记录";
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  return `${(value / 1000).toFixed(1)} 秒`;
}

function MediaViewerVersionInfo({ info }: { info: ImageVersionInfo }) {
  const facts = [
    ["来源节点", info.sourceNode],
    ["服务商", info.provider],
    ["模型", info.model],
    ["图片尺寸", info.dimensions],
    ["生成时间", formatVersionTime(info.createdAt)],
    ["生成持续时间", formatGenerationDuration(info.generationDurationMs)],
    ["请求状态", info.status],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <div className="canvas-media-version-info">
      <div className="canvas-media-version-heading">
        <b>版本信息</b>
        <small>仅展示当前图片可公开的生成记录</small>
      </div>
      {facts.length > 0 && (
        <dl className="canvas-media-version-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {info.parameters && info.parameters.length > 0 && (
        <div className="canvas-media-version-parameters">
          <span>关键参数</span>
          <div>
            {info.parameters.map((parameter) => (
              <span key={`${parameter.label}:${parameter.value}`} title={`${parameter.label}: ${parameter.value}`}>
                <b>{parameter.label}</b> {parameter.value}
              </span>
            ))}
          </div>
        </div>
      )}
      {info.prompt && (
        <div className="canvas-media-version-prompt">
          <span>提示词</span>
          <p>{info.prompt}</p>
        </div>
      )}
    </div>
  );
}

export default function MediaViewer({
  item,
  references,
  initialCompare = false,
  onClose,
  onNavigate,
  onDownload,
  onNotify,
}: {
  item: MediaViewerItem;
  references: MediaViewerReference[];
  surface?: MediaViewerSurface;
  initialCompare?: boolean;
  parameters?: ImageCreationSettings | VideoCreationSettings;
  runtime?: unknown;
  model?: string;
  agentAvailable?: boolean;
  onClose: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  onPromptSave?: (value: string) => void;
  onParametersChange?: (settings: CreationSettings) => void;
  onEdit?: () => void;
  onLocalEdit?: () => void;
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
  const [showParameters, setShowParameters] = useState(false);
  const pointerStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const sliderPointerId = useRef<number | null>(null);

  const currentPrompt = (item.prompt || item.versionInfo?.prompt || "").trim();
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
    setShowParameters(false);
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
    if (target.closest("button, input, textarea, select, option, video, audio, .media-viewer-divider")) return;
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

  const handleMediaLoad = (side: MediaViewerSide, element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement) => {
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element instanceof HTMLImageElement ? element.naturalWidth : 640;
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element instanceof HTMLImageElement ? element.naturalHeight : 120;
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

  const copyPrompt = async () => {
    const prompt = currentPrompt;
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      onNotify("提示词已复制");
    } catch {
      onNotify("复制提示词失败，请检查剪贴板权限", "error");
    }
  };

  const download = (variant: "original" | "share") => {
    if (onDownload) return onDownload(variant);
    const anchor = document.createElement("a");
    anchor.href = item.url;
    const originalLabel = item.kind === "video" ? "原视频" : item.kind === "audio" ? "原音频" : "原图";
    const extension = item.kind === "video" ? "mp4" : item.kind === "audio" ? "mp3" : "png";
    anchor.download = `${item.name || "SANMAO素材"}-${variant === "share" ? "分享版" : originalLabel}.${extension}`;
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
            {item.versionInfo && <button type="button" className={`media-viewer-header-button media-viewer-settings-button ${showParameters ? "active" : ""}`} onClick={() => setShowParameters((value) => !value)}><span className="media-viewer-button-icon" aria-hidden="true">ⓘ</span><span>参数查看</span></button>}
            <div className="media-viewer-download-group" role="group" aria-label="下载">
              <button type="button" className="media-viewer-download-button original" onClick={() => download("original")}><span className="media-viewer-button-icon" aria-hidden="true">↓</span><span>{item.kind === "video" ? "原视频" : item.kind === "audio" ? "原音频" : "原图"}</span></button>
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
                {item.kind === "video" ? <video src={item.url} controls playsInline style={mediaStyle} onLoadedMetadata={(event) => handleMediaLoad("item", event.currentTarget)} /> : item.kind === "audio" ? <audio src={item.url} controls style={mediaStyle} onLoadedMetadata={(event) => handleMediaLoad("item", event.currentTarget)} /> : <img className="media-viewer-copyable-image" draggable={false} src={item.url} alt={item.name} style={mediaStyle} onLoad={(event) => handleMediaLoad("item", event.currentTarget)} />}
              </div>
            </div>
          )}
          <span className="media-viewer-wheel-tip">滚轮缩放 · 双击复位{zoom > 1 ? " · 拖动查看" : ""} · 点击百分比恢复完整画面</span>
        </div>

        {references.length > 0 && (
          <section className="media-viewer-reference-panel">
            <div className="media-viewer-reference-head"><b>参考素材 · {references.length} 项</b><small>点击切换对比对象</small></div>
            <div className="media-viewer-reference-list">
              {references.map((reference, index) => (
                <button type="button" className={reference.id === selectedReference?.id ? "active" : ""} key={reference.id} onClick={() => { setSelectedReferenceId(reference.id); if (reference.kind === "image") setCompare(true); }}>
                  {reference.kind === "video" ? <video src={reference.url} muted playsInline /> : reference.kind === "audio" ? <span className="media-viewer-audio-thumb">♫</span> : <img src={reference.url} alt={reference.name} />}
                  <span>{reference.kind === "audio" ? "音频" : "图"} {index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="canvas-media-viewer-prompt">
          <div className="canvas-media-viewer-prompt-head">
            <span>提示词</span>
            <div className="canvas-media-viewer-prompt-actions">
              <button type="button" disabled={!currentPrompt.trim()} onClick={() => void copyPrompt()}>复制提示词</button>
            </div>
          </div>
          <div className="canvas-media-viewer-prompt-content">
            <p className={currentPrompt ? "" : "empty"}>{currentPrompt || "当前节点没有保存提示词"}</p>
          </div>
        </div>

        {showParameters && item.versionInfo && (
          <section className="canvas-media-parameters">
            <header><b>参数查看</b><small>仅展示当前版本的生成参数和记录，不会修改当前节点</small></header>
            <MediaViewerVersionInfo info={item.versionInfo} />
          </section>
        )}
      </div>
    </div>
  );
}

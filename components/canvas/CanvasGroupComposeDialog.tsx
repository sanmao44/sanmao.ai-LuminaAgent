"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  gridCompositeLayout,
  renderCanvasImageGridComposite,
  type CanvasImageGridCropOffset,
  type CanvasImageGridCompositeOptions,
  type CanvasImageGridLayoutMode,
  type ImageSize,
} from "@/lib/canvas/image-operations";
import SelectMenu from "@/components/SelectMenu";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";

export type CanvasGroupComposeOrder = "canvas" | "group" | "custom";

export type CanvasGroupComposeSource = {
  id: string;
  url: string;
  name: string;
  canvasIndex: number;
  groupIndex: number;
};

export type CanvasGroupComposeSettings = CanvasImageGridCompositeOptions & {
  order: CanvasGroupComposeOrder;
  sourceOrderIds?: string[];
};

type Props = {
  groupName: string;
  sources: CanvasGroupComposeSource[];
  open: boolean;
  onClose: () => void;
  onConfirm: (settings: CanvasGroupComposeSettings) => Promise<boolean | void> | boolean | void;
};

const DEFAULT_SETTINGS: CanvasGroupComposeSettings = {
  order: "canvas",
  layoutMode: "auto",
  cellSize: 1024,
  gap: 16,
  maxEdge: 6144,
  background: "#ffffff",
  fit: "contain",
  cropPosition: "center",
};

const BACKGROUND_COLORS = [
  { value: "#f8fafc", label: "雾白" },
  { value: "#e2e8f0", label: "浅灰" },
  { value: "#cbd5e1", label: "灰蓝" },
  { value: "#fecaca", label: "浅红" },
  { value: "#fed7aa", label: "浅橙" },
  { value: "#fef08a", label: "浅黄" },
  { value: "#bbf7d0", label: "浅绿" },
  { value: "#a5f3fc", label: "浅青" },
  { value: "#bfdbfe", label: "浅蓝" },
  { value: "#ddd6fe", label: "浅紫" },
  { value: "#fbcfe8", label: "浅粉" },
  { value: "#334155", label: "深灰蓝" },
];

const CELL_SIZE_MIN = 256;
const CELL_SIZE_MAX = 2048;
const MAX_EDGE_MIN = 2048;
const MAX_EDGE_MAX = 6144;
const PREVIEW_ZOOM_MIN = 0.65;
const PREVIEW_ZOOM_MAX = 2.4;
const COMPOSE_SELECT_MENU_PROPS = {
  portalZIndex: CANVAS_Z_INDEX.modalPopover,
  className: "canvas-compose-select",
  menuClassName: "canvas-compose-select-menu",
};

function formatPixels(value: number) {
  return `${value.toLocaleString("zh-CN")}px`;
}

function backgroundPreset(value: string | undefined) {
  if (value === "#ffffff") return "white";
  if (value === "#000000") return "black";
  if (value === "transparent") return "transparent";
  return "custom";
}

function sortedSources(
  sources: CanvasGroupComposeSource[],
  order: Exclude<CanvasGroupComposeOrder, "custom">,
) {
  return [...sources].sort((left, right) =>
    order === "group"
      ? left.groupIndex - right.groupIndex
      : left.canvasIndex - right.canvasIndex,
  );
}

function sourcesWithOrder(
  sources: CanvasGroupComposeSource[],
  order: CanvasGroupComposeOrder,
  sourceOrderIds?: string[],
) {
  if (order !== "custom" || !sourceOrderIds?.length) {
    return sortedSources(sources, order === "group" ? "group" : "canvas");
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const ordered = sourceOrderIds
    .map((id) => sourceById.get(id))
    .filter((source): source is CanvasGroupComposeSource => Boolean(source));
  const included = new Set(ordered.map((source) => source.id));
  return [...ordered, ...sources.filter((source) => !included.has(source.id))];
}

function clampCropOffset(value: CanvasImageGridCropOffset): CanvasImageGridCropOffset {
  return {
    x: Math.max(0, Math.min(1, Number(value.x) || 0)),
    y: Math.max(0, Math.min(1, Number(value.y) || 0)),
  };
}

function normalizeHex(value: string) {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-f]{6}$/i.test(withHash)) return withHash.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(withHash)) {
    return `#${withHash.slice(1).split("").map((value) => `${value}${value}`).join("")}`.toLowerCase();
  }
  return null;
}

const CROP_POSITION_OFFSETS: Record<NonNullable<CanvasImageGridCompositeOptions["cropPosition"]>, CanvasImageGridCropOffset> = {
  "top-left": { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

type GridDragState = {
  sourceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: CanvasImageGridCropOffset;
  overflowX: number;
  overflowY: number;
};

type SourceDragState = {
  sourceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastTargetId: string;
};

export default function CanvasGroupComposeDialog({
  groupName,
  sources,
  open,
  onClose,
  onConfirm,
}: Props) {
  const [settings, setSettings] = useState<CanvasGroupComposeSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cropOffsetsBySource, setCropOffsetsBySource] = useState<Record<string, CanvasImageGridCropOffset>>({});
  const [activeCropSourceId, setActiveCropSourceId] = useState("");
  const [sourceSizesById, setSourceSizesById] = useState<Record<string, ImageSize>>({});
  const [previewZoom, setPreviewZoom] = useState(1);
  const previewUrlRef = useRef("");
  const previewRevisionRef = useRef(0);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const gridDragRef = useRef<GridDragState | null>(null);
  const previewSortDragRef = useRef<SourceDragState | null>(null);
  const [previewViewportSize, setPreviewViewportSize] = useState({ width: 0, height: 0 });
  const [previewResult, setPreviewResult] = useState<{
    url: string;
    width: number;
    height: number;
    layout: ReturnType<typeof gridCompositeLayout>;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_SETTINGS });
    setBusy(false);
    setError("");
    setCropOffsetsBySource({});
    setSourceSizesById({});
    setActiveCropSourceId("");
    setPreviewZoom(1);
  }, [groupName, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".select-menu.open,.select-menu-popover") || window.document.querySelector(".select-menu.open,.select-menu-popover")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [busy, onClose, open]);

  const previewSources = useMemo(
    () => sourcesWithOrder(sources, settings.order, settings.sourceOrderIds),
    [settings.order, settings.sourceOrderIds, sources],
  );
  const previewSourceKey = previewSources.map((source) => `${source.id}\u0001${source.url}`).join("\u0002");
  const previewSourceUrls = useMemo(() => previewSources.map((source) => source.url), [previewSourceKey]);
  const sourceSizes = useMemo(
    () => previewSources.map((source) => sourceSizesById[source.id] || { width: 1, height: 1 }),
    [previewSources, sourceSizesById],
  );
  const cropOffsetForSource = (sourceId: string) => cropOffsetsBySource[sourceId] || CROP_POSITION_OFFSETS[settings.cropPosition || "center"];
  const renderOptions = useMemo<CanvasImageGridCompositeOptions>(() => ({
    layoutMode: settings.layoutMode,
    columns: settings.columns,
    cellSize: settings.cellSize,
    gap: settings.gap,
    maxEdge: settings.maxEdge,
    background: settings.background,
    fit: settings.layoutMode === "auto" ? "contain" : settings.fit,
    cropPosition: settings.cropPosition,
    cropOffsets: previewSources.map((source) => cropOffsetsBySource[source.id]),
    sourceSizes,
  }), [cropOffsetsBySource, previewSources, settings, sourceSizes]);
  const background = settings.background || "#ffffff";
  const layout = useMemo(
    () => gridCompositeLayout(Math.max(1, previewSources.length), renderOptions),
    [previewSources.length, renderOptions],
  );
  const displayedLayout = previewResult?.layout || layout;

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    previewSources.forEach((source) => {
      const image = new Image();
      image.onload = () => {
        if (disposed) return;
        setSourceSizesById((current) => ({
          ...current,
          [source.id]: {
            width: image.naturalWidth || image.width || 1,
            height: image.naturalHeight || image.height || 1,
          },
        }));
      };
      image.src = source.url;
    });
    return () => { disposed = true; };
  }, [open, previewSourceKey]);

  useEffect(() => {
    if (open) return;
    previewRevisionRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewResult(null);
    setPreviewBusy(false);
    setPreviewError("");
  }, [open]);

  useEffect(() => {
    if (!open || previewSourceUrls.length === 0) return;
    const revision = ++previewRevisionRef.current;
    let disposed = false;
    setPreviewBusy(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      void renderCanvasImageGridComposite(previewSourceUrls, renderOptions)
        .then((rendered) => {
          if (disposed || revision !== previewRevisionRef.current) return;
          const url = URL.createObjectURL(rendered.blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = url;
          setPreviewResult({
            url,
            width: rendered.size.width,
            height: rendered.size.height,
            layout: rendered.layout,
          });
          setPreviewBusy(false);
        })
        .catch((reason) => {
          if (disposed || revision !== previewRevisionRef.current) return;
          setPreviewBusy(false);
          setPreviewError(reason instanceof Error ? reason.message : "实时预览生成失败");
        });
    }, 80);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [open, previewSourceUrls, renderOptions]);

  useEffect(() => {
    if (!open || !previewResult) return;
    const element = previewScrollRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const computed = window.getComputedStyle(element);
      const width = Math.max(0, rect.width - Number.parseFloat(computed.paddingLeft) - Number.parseFloat(computed.paddingRight));
      const height = Math.max(0, rect.height - Number.parseFloat(computed.paddingTop) - Number.parseFloat(computed.paddingBottom));
      setPreviewViewportSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, previewResult]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  if (!open) return null;

  const update = <K extends keyof CanvasGroupComposeSettings>(
    key: K,
    value: CanvasGroupComposeSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const resetSettings = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    setCropOffsetsBySource({});
    setError("");
    setPreviewZoom(1);
  };

  const setOrderPreset = (order: Exclude<CanvasGroupComposeOrder, "custom">) => {
    setSettings((current) => ({ ...current, order, sourceOrderIds: undefined }));
  };

  const reorderSources = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const next = [...previewSources];
    const from = next.findIndex((source) => source.id === sourceId);
    const target = next.findIndex((source) => source.id === targetId);
    if (from < 0 || target < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(next.findIndex((source) => source.id === targetId), 0, moved);
    setSettings((current) => ({
      ...current,
      order: "custom",
      sourceOrderIds: next.map((source) => source.id),
    }));
  };

  const moveSource = (sourceId: string, direction: -1 | 1) => {
    const index = previewSources.findIndex((source) => source.id === sourceId);
    const target = previewSources[index + direction];
    if (index < 0 || !target) return;
    reorderSources(sourceId, target.id);
  };

  const onPreviewSortPointerDown = (sourceId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    previewSortDragRef.current = {
      sourceId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastTargetId: sourceId,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events may not have an active pointer to capture.
    }
  };

  const onPreviewSortPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewSortDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-compose-preview-source-id]");
    const targetId = target?.dataset.composePreviewSourceId;
    if (!targetId || targetId === drag.lastTargetId || targetId === drag.sourceId) return;
    drag.lastTargetId = targetId;
    reorderSources(drag.sourceId, targetId);
  };

  const onPreviewSortPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewSortDragRef.current?.pointerId === event.pointerId) previewSortDragRef.current = null;
  };

  const onPreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (busy || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const steps = Math.min(3, Math.max(1, Math.round(Math.abs(event.deltaY) / 80)));
    const delta = (event.deltaY < 0 ? 1 : -1) * steps * 0.1;
    setPreviewZoom((value) => Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Number((value + delta).toFixed(2)))));
  };

  const updateCropOffset = (sourceId: string, value: CanvasImageGridCropOffset) => {
    setCropOffsetsBySource((current) => ({ ...current, [sourceId]: clampCropOffset(value) }));
  };

  const onGridPointerDown = (sourceId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (settings.layoutMode !== "fixed" || settings.fit !== "cover") return;
    const cellSize = event.currentTarget.getBoundingClientRect().width;
    const source = sourceSizesById[sourceId] || { width: 1, height: 1 };
    const ratio = source.width / Math.max(1, source.height);
    gridDragRef.current = {
      sourceId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: cropOffsetForSource(sourceId),
      overflowX: Math.max(0, cellSize * ratio - cellSize),
      overflowY: Math.max(0, cellSize / Math.max(0.001, ratio) - cellSize),
    };
    setActiveCropSourceId(sourceId);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events may not have an active pointer to capture.
    }
  };

  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = gridDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateCropOffset(drag.sourceId, {
      x: drag.startOffset.x - (event.clientX - drag.startX) / Math.max(1, drag.overflowX),
      y: drag.startOffset.y - (event.clientY - drag.startY) / Math.max(1, drag.overflowY),
    });
  };

  const onGridPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gridDragRef.current?.pointerId === event.pointerId) gridDragRef.current = null;
  };

  const onPreviewCellDoubleClick = (sourceId: string, event: ReactMouseEvent<HTMLDivElement>) => {
    if (busy) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveCropSourceId(sourceId);
    setSettings((current) => ({
      ...current,
      layoutMode: "fixed",
      fit: "cover",
    }));
  };

  const changeLayoutMode = (value: CanvasImageGridLayoutMode) => {
    setSettings((current) => ({
      ...current,
      layoutMode: value,
      fit: value === "auto" ? "contain" : current.fit,
    }));
  };

  const changeBackground = (value: string) => {
    const normalized = normalizeHex(value);
    if (normalized) update("background", normalized);
  };

  const customBackgroundColor = background === "transparent" ? "#ffffff" : background;

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await onConfirm({
        ...settings,
        sourceOrderIds: previewSources.map((source) => source.id),
        cropOffsets: previewSources.map((source) => cropOffsetsBySource[source.id]),
      });
      if (result === false) setBusy(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "宫格拼接失败");
      setBusy(false);
    }
  };

  const showCropHandles = settings.layoutMode === "fixed" && settings.fit === "cover";
  const previewInteractionClass = showCropHandles ? "interactive crop" : "interactive sortable";
  const previewInteractionHint = showCropHandles
    ? "裁切模式 · 拖动图片调整显示范围 · 双击切换图片"
    : "双击图片进入裁切模式 · 拖动图片调整顺序";
  const previewFrameSize = useMemo(() => {
    const sourceWidth = Math.max(1, displayedLayout.width);
    const sourceHeight = Math.max(1, displayedLayout.height);
    if (previewViewportSize.width <= 0 || previewViewportSize.height <= 0) return null;
    const scale = Math.min(previewViewportSize.width / sourceWidth, previewViewportSize.height / sourceHeight);
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }, [displayedLayout.height, displayedLayout.width, previewViewportSize]);

  return (
    <div
      className="canvas-compose-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="canvas-compose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-compose-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="canvas-compose-dialog-head">
          <div>
            <span>对象组 · {sources.length} 张图片</span>
            <h2 id="canvas-compose-title">宫格拼接工作台</h2>
            <small>{groupName} · 原图比例、顺序和背景均可直接调整</small>
          </div>
          <div className="canvas-compose-head-actions">
            <button type="button" className="canvas-compose-reset" onClick={resetSettings} disabled={busy}>恢复默认</button>
            <button type="button" className="canvas-compose-close" onClick={onClose} disabled={busy} aria-label="关闭宫格拼接设置">×</button>
          </div>
        </header>

        <div className="canvas-compose-dialog-body">
          <div className="canvas-compose-preview-column">
            <div className="canvas-compose-preview-label">
              <span><i aria-hidden="true" />实时预览</span>
              <small>{previewSources.length} 张图片 · {previewInteractionHint}</small>
            </div>

            <div className="canvas-compose-preview-toolbar">
              <div className="canvas-compose-preview-zoom" role="group" aria-label="预览缩放">
                <button type="button" onClick={() => setPreviewZoom((value) => Math.max(PREVIEW_ZOOM_MIN, Number((value - 0.15).toFixed(2))))} disabled={previewZoom <= PREVIEW_ZOOM_MIN} aria-label="缩小预览">−</button>
                <output>{Math.round(previewZoom * 100)}%</output>
                <button type="button" onClick={() => setPreviewZoom((value) => Math.min(PREVIEW_ZOOM_MAX, Number((value + 0.15).toFixed(2))))} disabled={previewZoom >= PREVIEW_ZOOM_MAX} aria-label="放大预览">＋</button>
                <button type="button" onClick={() => setPreviewZoom(1)} aria-label="适应窗口预览">适应</button>
              </div>
              <span className="canvas-compose-preview-size">{displayedLayout.width} × {displayedLayout.height}px</span>
            </div>

            <div
              className={`canvas-compose-preview-viewport ${background === "transparent" ? "transparent" : ""} ${previewBusy ? "is-updating" : ""}`}
              aria-label={`宫格预览 ${displayedLayout.columns} 列 ${displayedLayout.rows} 行`}
              onWheel={onPreviewWheel}
              onDragStart={(event) => event.preventDefault()}
            >
              {previewResult ? (
                <div className={`canvas-compose-preview-scroll ${previewZoom === 1 ? "is-fit" : "is-zoomed"}`} ref={previewScrollRef}>
                  <div
                    className="canvas-compose-preview-result-shell"
                    style={{
                      ...(previewFrameSize ? { width: `${previewFrameSize.width}px`, height: `${previewFrameSize.height}px` } : {}),
                      ...(previewZoom === 1 ? {} : { transform: `scale(${previewZoom})` }),
                    }}
                  >
                    <img
                      className="canvas-compose-preview-result"
                      src={previewResult.url}
                      alt="宫格拼接实时预览（与最终出图一致）"
                      draggable={false}
                    />
                    <div className={`canvas-compose-preview-hit-area ${previewInteractionClass}`} aria-label={showCropHandles ? "拖动每格图片调整裁切区域" : "拖动图片调整顺序"}>
                      {previewSources.map((source, index) => {
                        const placement = displayedLayout.placements[index];
                        if (!placement) return null;
                        const placementStyle = {
                          left: `${(placement.x / Math.max(1, displayedLayout.width)) * 100}%`,
                          top: `${(placement.y / Math.max(1, displayedLayout.height)) * 100}%`,
                          width: `${(placement.width / Math.max(1, displayedLayout.width)) * 100}%`,
                          height: `${(placement.height / Math.max(1, displayedLayout.height)) * 100}%`,
                        };
                        return (
                          <div
                            key={source.id}
                            className={`canvas-compose-preview-hit-cell ${source.id === activeCropSourceId ? "active" : ""}`}
                            style={placementStyle}
                            data-compose-preview-source-id={source.id}
                            role="group"
                            aria-label={showCropHandles ? `第 ${index + 1} 张图片，拖动调整裁切区域` : `第 ${index + 1} 张图片，拖动调整顺序`}
                            title={showCropHandles ? "拖动调整裁切区域" : "拖动到另一张图片上方交换顺序"}
                            onPointerDown={showCropHandles ? (event) => onGridPointerDown(source.id, event) : (event) => onPreviewSortPointerDown(source.id, event)}
                            onPointerMove={showCropHandles ? onGridPointerMove : onPreviewSortPointerMove}
                            onPointerUp={showCropHandles ? onGridPointerUp : onPreviewSortPointerUp}
                            onPointerCancel={showCropHandles ? onGridPointerUp : onPreviewSortPointerUp}
                            onClick={showCropHandles ? () => setActiveCropSourceId(source.id) : undefined}
                            onDoubleClick={(event) => onPreviewCellDoubleClick(source.id, event)}
                          >
                            <span className="canvas-compose-preview-cell-number">{index + 1}</span>
                            <span className="canvas-compose-preview-cell-name">{source.name}</span>
                            <div className="canvas-compose-preview-cell-tools" onPointerDown={(event) => event.stopPropagation()}>
                              <button type="button" onClick={() => moveSource(source.id, -1)} disabled={index === 0 || busy} aria-label={`第 ${index + 1} 张图片上移`}>↑</button>
                              <button type="button" onClick={() => moveSource(source.id, 1)} disabled={index === previewSources.length - 1 || busy} aria-label={`第 ${index + 1} 张图片下移`}>↓</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="canvas-compose-preview-empty" aria-live="polite">{previewBusy ? "正在生成预览…" : "暂无预览"}</div>
              )}
              {previewBusy && previewResult && <span className="canvas-compose-preview-status">正在更新预览…</span>}
            </div>

            <div className="canvas-compose-summary" aria-live="polite">
              <span><b>{displayedLayout.columns} × {displayedLayout.rows}</b><small>布局</small></span>
              <span><b>{displayedLayout.width} × {displayedLayout.height}</b><small>输出尺寸</small></span>
              <span><b>{Math.round(displayedLayout.scale * 100)}%</b><small>输出缩放</small></span>
              <span><b>{formatPixels(displayedLayout.gap)}</b><small>图片间隔</small></span>
            </div>

          </div>

          <div className="canvas-compose-settings-column">
            <div className="canvas-compose-settings-scroll">
              <div className="canvas-compose-fields">
                <div className="canvas-compose-field-wide canvas-compose-order-panel">
                  <span className="canvas-compose-field-title">图片顺序 <em>直接拖动预览中的图片即可调整</em></span>
                  <div className="canvas-compose-order-presets" role="group" aria-label="图片顺序快捷方式">
                    <button type="button" className={settings.order === "canvas" ? "active" : ""} onClick={() => setOrderPreset("canvas")} disabled={busy}>画布顺序</button>
                    <button type="button" className={settings.order === "group" ? "active" : ""} onClick={() => setOrderPreset("group")} disabled={busy}>组内顺序</button>
                    <span className={settings.order === "custom" ? "active" : ""}>自定义顺序</span>
                  </div>
                </div>

                <label className="canvas-compose-field-wide">
                  <span>排版模式 <em>{settings.layoutMode === "auto" ? "完整保留原图比例" : "传统固定方格"}</em></span>
                  <span className="canvas-compose-select-shell">
                    <SelectMenu
                      {...COMPOSE_SELECT_MENU_PROPS}
                      value={settings.layoutMode || "auto"}
                      ariaLabel="排版模式"
                      options={[
                        { value: "auto", label: "自动等比紧凑", description: "同比例成网格，混合比例按行铺满" },
                        { value: "fixed", label: "固定方格", description: "保留固定正方形单元和裁切选项" },
                      ]}
                      onChange={(value) => changeLayoutMode(value as CanvasImageGridLayoutMode)}
                    />
                  </span>
                </label>

                <label>
                  <span>列数 <em>{settings.columns ? "手动" : "推荐"}</em></span>
                  <span className="canvas-compose-select-shell">
                    <SelectMenu
                      {...COMPOSE_SELECT_MENU_PROPS}
                      value={settings.columns === undefined ? "auto" : String(settings.columns)}
                      ariaLabel="列数"
                      options={[
                        { value: "auto", label: "自动（接近方阵）", description: "根据图片数量自动平衡" },
                        ...Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 列` })),
                      ]}
                      onChange={(value) => update("columns", value === "auto" ? undefined : Number(value))}
                    />
                  </span>
                </label>

                <label className="canvas-compose-range-field">
                  <span><span>{settings.layoutMode === "auto" ? "基础行高" : "单格尺寸"}</span><output>{formatPixels(settings.cellSize ?? DEFAULT_SETTINGS.cellSize!)}</output></span>
                  <input aria-label="单格尺寸" type="range" min={CELL_SIZE_MIN} max={CELL_SIZE_MAX} step={64} value={settings.cellSize ?? DEFAULT_SETTINGS.cellSize} onChange={(event) => update("cellSize", Number(event.target.value))} />
                  <small><span>{formatPixels(CELL_SIZE_MIN)}</span><span>越大越清晰</span><span>{formatPixels(CELL_SIZE_MAX)}</span></small>
                </label>

                <label className="canvas-compose-range-field">
                  <span><span>图片间隔</span><output>{formatPixels(settings.gap ?? DEFAULT_SETTINGS.gap!)}</output></span>
                  <input aria-label="图片间隔" type="range" min={0} max={128} step={1} value={settings.gap ?? DEFAULT_SETTINGS.gap} onChange={(event) => update("gap", Number(event.target.value))} />
                  <small><span>紧凑</span><span>舒适</span><span>宽松</span></small>
                </label>

                {settings.layoutMode === "fixed" && (
                  <div className="canvas-compose-choice-field canvas-compose-field-wide">
                    <span>图片适配 <em>固定方格模式</em></span>
                    <div className="canvas-compose-segmented" role="group" aria-label="图片适配">
                      <button type="button" aria-pressed={settings.fit === "contain"} className={settings.fit === "contain" ? "active" : ""} onClick={() => update("fit", "contain")}><b>完整显示</b><small>不裁切</small></button>
                      <button type="button" aria-pressed={settings.fit === "cover"} className={settings.fit === "cover" ? "active" : ""} onClick={() => update("fit", "cover")}><b>铺满单格</b><small>允许裁切</small></button>
                    </div>
                  </div>
                )}

                <label className="canvas-compose-range-field">
                  <span><span>输出边长上限</span><output>{formatPixels(settings.maxEdge ?? DEFAULT_SETTINGS.maxEdge!)}</output></span>
                  <input aria-label="输出边长上限" type="range" min={MAX_EDGE_MIN} max={MAX_EDGE_MAX} step={2048} value={settings.maxEdge ?? DEFAULT_SETTINGS.maxEdge} onChange={(event) => update("maxEdge", Number(event.target.value))} />
                  <small><span>轻量</span><span>平衡</span><span>高清</span></small>
                </label>

                <div className="canvas-compose-background-field canvas-compose-field-wide">
                  <span className="canvas-compose-field-title">背景 <em>透明适合继续编辑</em></span>
                  <div className="canvas-compose-background-row">
                    <div className="canvas-compose-color-palette" role="group" aria-label="背景颜色预设">
                      <button type="button" className={`canvas-compose-background-swatch white ${backgroundPreset(background) === "white" ? "active" : ""}`} onClick={() => update("background", "#ffffff")} aria-label="白色背景" aria-pressed={backgroundPreset(background) === "white"} title="白色" />
                      <button type="button" className={`canvas-compose-background-swatch black ${backgroundPreset(background) === "black" ? "active" : ""}`} onClick={() => update("background", "#000000")} aria-label="黑色背景" aria-pressed={backgroundPreset(background) === "black"} title="黑色" />
                      <button type="button" className={`canvas-compose-background-swatch transparent ${backgroundPreset(background) === "transparent" ? "active" : ""}`} onClick={() => update("background", "transparent")} aria-label="透明背景" aria-pressed={backgroundPreset(background) === "transparent"} title="透明" />
                      {BACKGROUND_COLORS.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          className={`canvas-compose-background-swatch ${background === color.value ? "active" : ""}`}
                          style={{ backgroundColor: color.value }}
                          onClick={() => update("background", color.value)}
                          aria-label={`${color.label}背景`}
                          aria-pressed={background === color.value}
                          title={color.label}
                        />
                      ))}
                    </div>
                    <label className={`canvas-compose-custom-color ${backgroundPreset(background) === "custom" ? "active" : ""}`} title="打开颜色面板选择自定义背景色">
                      <span className="canvas-compose-custom-color-preview" style={{ backgroundColor: customBackgroundColor }} aria-hidden="true" />
                      <span>自定义</span>
                      <input className="canvas-compose-color-picker" type="color" value={customBackgroundColor} onChange={(event) => changeBackground(event.target.value)} aria-label="打开自定义背景颜色面板" />
                    </label>
                  </div>
                </div>
              </div>

              {settings.layoutMode === "auto" && <p className="canvas-compose-hint">自动等比模式会完整显示原图：同比例图片生成真正等比宫格，比例混合时按行紧凑排版。</p>}
              {layout.scale < 1 && <p className="canvas-compose-hint">当前布局超过输出边长上限，导出时会自动缩小到 {layout.width} × {layout.height}。</p>}
              {previewError && <p className="canvas-compose-error" role="alert">{previewError}</p>}
              {error && <p className="canvas-compose-error" role="alert">{error}</p>}
            </div>
          </div>
        </div>

        <footer className="canvas-compose-dialog-foot">
          <span>原图保留 · 结果会自动连接到组内图片</span>
          <div>
            <button type="button" onClick={onClose} disabled={busy}>取消</button>
            <button type="button" className="primary" onClick={() => void confirm()} disabled={busy || sources.length < 2}>{busy ? "拼接中…" : "确认拼接"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

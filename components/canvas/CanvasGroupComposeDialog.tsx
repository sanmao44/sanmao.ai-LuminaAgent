"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  gridCompositeLayout,
  renderCanvasImageGridComposite,
  type CanvasImageGridCropOffset,
  type CanvasImageGridCompositeOptions,
} from "@/lib/canvas/image-operations";
import SelectMenu from "@/components/SelectMenu";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";

export type CanvasGroupComposeOrder = "canvas" | "group";

export type CanvasGroupComposeSource = {
  id: string;
  url: string;
  name: string;
  canvasIndex: number;
  groupIndex: number;
};

export type CanvasGroupComposeSettings = CanvasImageGridCompositeOptions & {
  order: CanvasGroupComposeOrder;
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
  cellSize: 1024,
  gap: 16,
  maxEdge: 6144,
  background: "#ffffff",
  fit: "contain",
  cropPosition: "center",
};

const CELL_SIZE_MIN = 256;
const CELL_SIZE_MAX = 2048;
const MAX_EDGE_MIN = 2048;
const MAX_EDGE_MAX = 6144;
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
  order: CanvasGroupComposeOrder,
) {
  return [...sources].sort((left, right) =>
    order === "group"
      ? left.groupIndex - right.groupIndex
      : left.canvasIndex - right.canvasIndex,
  );
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

function clampCropOffset(value: CanvasImageGridCropOffset): CanvasImageGridCropOffset {
  return {
    x: Math.max(0, Math.min(1, Number(value.x) || 0)),
    y: Math.max(0, Math.min(1, Number(value.y) || 0)),
  };
}

type GridDragState = {
  sourceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: CanvasImageGridCropOffset;
  overflowX: number;
  overflowY: number;
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
  const [sourceRatios, setSourceRatios] = useState<Record<string, number>>({});
  const previewUrlRef = useRef("");
  const previewRevisionRef = useRef(0);
  const gridDragRef = useRef<GridDragState | null>(null);
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
    setSourceRatios({});
    setActiveCropSourceId("");
  }, [open, groupName]);

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
    () => sortedSources(sources, settings.order),
    [settings.order, sources],
  );
  const layout = useMemo(
    () => gridCompositeLayout(Math.max(1, previewSources.length), settings),
    [previewSources.length, settings],
  );
  const previewSourceKey = previewSources.map((source) => `${source.id}\u0001${source.url}`).join("\u0002");
  const previewSourceUrls = useMemo(() => previewSources.map((source) => source.url), [previewSourceKey]);
  const cropOffsetForSource = (sourceId: string) => cropOffsetsBySource[sourceId] || CROP_POSITION_OFFSETS[settings.cropPosition || "center"];
  const renderOptions = useMemo<CanvasImageGridCompositeOptions>(() => ({
    ...settings,
    cropOffsets: previewSources.map((source) => cropOffsetsBySource[source.id]),
  }), [cropOffsetsBySource, previewSources, settings]);
  const background = settings.background || "#ffffff";
  const displayedLayout = previewResult?.layout || layout;

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    previewSources.forEach((source) => {
      const image = new Image();
      image.onload = () => {
        if (disposed) return;
        setSourceRatios((current) => ({
          ...current,
          [source.id]: (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1),
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
  };

  const updateCropOffset = (sourceId: string, value: CanvasImageGridCropOffset) => {
    setCropOffsetsBySource((current) => ({ ...current, [sourceId]: clampCropOffset(value) }));
  };

  const onGridPointerDown = (sourceId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (settings.fit !== "cover") return;
    const cellSize = event.currentTarget.getBoundingClientRect().width;
    const ratio = sourceRatios[sourceId] || 1;
    gridDragRef.current = {
      sourceId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: cropOffsetForSource(sourceId),
      overflowX: Math.max(0, cellSize * ratio - cellSize),
      overflowY: Math.max(0, cellSize / ratio - cellSize),
    };
    setActiveCropSourceId(sourceId);
    event.currentTarget.setPointerCapture(event.pointerId);
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

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await onConfirm({
        ...settings,
        cropOffsets: previewSources.map((source) => cropOffsetsBySource[source.id]),
      });
      if (result === false) {
        setBusy(false);
        return;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "宫格拼接失败");
      setBusy(false);
    }
  };

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
            <h2 id="canvas-compose-title">宫格拼接</h2>
            <small>{groupName} · 生成新的画布图片节点</small>
          </div>
          <div className="canvas-compose-head-actions">
            <button type="button" className="canvas-compose-reset" onClick={resetSettings} disabled={busy}>
              恢复默认
            </button>
            <button type="button" className="canvas-compose-close" onClick={onClose} disabled={busy} aria-label="关闭宫格拼接设置">×</button>
          </div>
        </header>

        <div className="canvas-compose-dialog-body">
          <div className="canvas-compose-preview-column">
            <div className="canvas-compose-preview-label">
              <span><i aria-hidden="true" />实时预览</span>
              <small>{previewSources.length} 张图片 · 铺满单格时可直接拖动每格</small>
            </div>

            <div
              className={`canvas-compose-preview-viewport ${background === "transparent" ? "transparent" : ""} ${previewBusy ? "is-updating" : ""}`}
              aria-label={`宫格预览 ${displayedLayout.columns} 列 ${displayedLayout.rows} 行`}
            >
              {previewResult ? (
                <div className="canvas-compose-preview-result-shell">
                  <img
                    className="canvas-compose-preview-result"
                    src={previewResult.url}
                    alt="宫格拼接实时预览（与最终出图一致）"
                  />
                  {settings.fit === "cover" && (
                    <div className="canvas-compose-preview-hit-area" aria-label="拖动每格图片调整裁切区域">
                      {previewSources.map((source, index) => {
                        const column = index % displayedLayout.columns;
                        const row = Math.floor(index / displayedLayout.columns);
                        return (
                          <div
                            key={source.id}
                            className={`canvas-compose-preview-hit-cell ${source.id === activeCropSourceId ? "active" : ""}`}
                            style={{
                              left: `${((column * (displayedLayout.cellSize + displayedLayout.gap)) / Math.max(1, displayedLayout.width)) * 100}%`,
                              top: `${((row * (displayedLayout.cellSize + displayedLayout.gap)) / Math.max(1, displayedLayout.height)) * 100}%`,
                              width: `${(displayedLayout.cellSize / Math.max(1, displayedLayout.width)) * 100}%`,
                              height: `${(displayedLayout.cellSize / Math.max(1, displayedLayout.height)) * 100}%`,
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`第 ${index + 1} 张图片，拖动调整裁切区域`}
                            onPointerDown={(event) => onGridPointerDown(source.id, event)}
                            onPointerMove={onGridPointerMove}
                            onPointerUp={onGridPointerUp}
                            onPointerCancel={onGridPointerUp}
                            onClick={() => setActiveCropSourceId(source.id)}
                          >
                            <span>{index + 1}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="canvas-compose-preview-empty" aria-live="polite">
                  {previewBusy ? "正在生成预览…" : "暂无预览"}
                </div>
              )}
              {previewBusy && previewResult && <span className="canvas-compose-preview-status">正在更新预览…</span>}
            </div>

            <div className="canvas-compose-summary" aria-live="polite">
              <span><b>{displayedLayout.columns} × {displayedLayout.rows}</b><small>布局</small></span>
              <span><b>{displayedLayout.width} × {displayedLayout.height}</b><small>输出尺寸</small></span>
              <span><b>{Math.round(displayedLayout.scale * 100)}%</b><small>缩放</small></span>
              <span><b>{formatPixels(displayedLayout.gap)}</b><small>图片间隔</small></span>
            </div>
          </div>

          <div className="canvas-compose-settings-column">
            <div className="canvas-compose-fields">
            <label className="canvas-compose-field-wide">
              <span>图片顺序 <em>影响拼接后的阅读顺序</em></span>
              <span className="canvas-compose-select-shell">
                <SelectMenu
                  {...COMPOSE_SELECT_MENU_PROPS}
                  value={settings.order}
                  ariaLabel="图片顺序"
                  options={[
                    { value: "canvas", label: "按画布阅读顺序", description: "从左到右、从上到下" },
                    { value: "group", label: "按组内加入顺序", description: "沿用对象组的加入顺序" },
                  ]}
                  onChange={(value) => update("order", value as CanvasGroupComposeOrder)}
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
                    ...Array.from({ length: 8 }, (_, index) => {
                      const value = String(index + 1);
                      return { value, label: `${value} 列` };
                    }),
                  ]}
                  onChange={(value) => update("columns", value === "auto" ? undefined : Number(value))}
                />
              </span>
            </label>
            <label className="canvas-compose-range-field">
              <span><span>单格尺寸</span><output>{formatPixels(settings.cellSize ?? DEFAULT_SETTINGS.cellSize!)}</output></span>
              <input aria-label="单格尺寸" type="range" min={CELL_SIZE_MIN} max={CELL_SIZE_MAX} step={64} value={settings.cellSize ?? DEFAULT_SETTINGS.cellSize} onChange={(event) => update("cellSize", Number(event.target.value))} />
              <small><span>{formatPixels(CELL_SIZE_MIN)}</span><span>越大越清晰</span><span>{formatPixels(CELL_SIZE_MAX)}</span></small>
            </label>
            <label className="canvas-compose-range-field">
              <span><span>图片间隔</span><output>{formatPixels(settings.gap ?? DEFAULT_SETTINGS.gap!)}</output></span>
              <input aria-label="图片间隔" type="range" min={0} max={128} step={1} value={settings.gap ?? DEFAULT_SETTINGS.gap} onChange={(event) => update("gap", Number(event.target.value))} />
              <small><span>紧凑</span><span>舒适</span><span>宽松</span></small>
            </label>
            <div className="canvas-compose-choice-field">
              <span>图片适配 <em>不改变原图</em></span>
              <div className="canvas-compose-fit-row">
                <div className="canvas-compose-segmented" role="group" aria-label="图片适配">
                  <button type="button" aria-pressed={settings.fit === "contain"} className={settings.fit === "contain" ? "active" : ""} onClick={() => update("fit", "contain")}>
                    <b>完整显示</b><small>不裁切</small>
                  </button>
                  <button type="button" aria-pressed={settings.fit === "cover"} className={settings.fit === "cover" ? "active" : ""} onClick={() => update("fit", "cover")}>
                    <b>铺满单格</b><small>允许裁切</small>
                  </button>
                </div>
              </div>
            </div>
            <label className="canvas-compose-range-field">
              <span><span>输出边长上限</span><output>{formatPixels(settings.maxEdge ?? DEFAULT_SETTINGS.maxEdge!)}</output></span>
              <input aria-label="输出边长上限" type="range" min={MAX_EDGE_MIN} max={MAX_EDGE_MAX} step={2048} value={settings.maxEdge ?? DEFAULT_SETTINGS.maxEdge} onChange={(event) => update("maxEdge", Number(event.target.value))} />
              <small><span>轻量</span><span>平衡</span><span>高清</span></small>
            </label>
            <label>
              <span>背景 <em>透明适合继续编辑</em></span>
              <span className="canvas-compose-select-shell canvas-compose-background-shell">
                <SelectMenu
                  {...COMPOSE_SELECT_MENU_PROPS}
                  value={backgroundPreset(settings.background)}
                  ariaLabel="背景"
                  options={[
                    { value: "white", label: "白色", description: "适合常规分享和打印" },
                    { value: "black", label: "黑色", description: "适合深色素材和展示" },
                    { value: "transparent", label: "透明", description: "适合继续编辑" },
                    { value: "custom", label: "自定义颜色", description: "点击右侧色块选择颜色" },
                  ]}
                  onChange={(value) => update("background", value === "white" ? "#ffffff" : value === "black" ? "#000000" : value === "transparent" ? "transparent" : backgroundPreset(settings.background) === "custom" ? settings.background || "#e5e7eb" : "#e5e7eb")}
                />
                {backgroundPreset(settings.background) === "custom" && <input className="canvas-compose-color" type="color" value={settings.background || "#e5e7eb"} onChange={(event) => update("background", event.target.value)} aria-label="自定义背景颜色" />}
              </span>
            </label>
            </div>

            {layout.scale < 1 && <p className="canvas-compose-hint">当前布局超过输出边长上限，导出时会自动缩小到 {layout.width} × {layout.height}。</p>}
            {previewError && <p className="canvas-compose-error" role="alert">{previewError}</p>}
            {error && <p className="canvas-compose-error" role="alert">{error}</p>}
          </div>
        </div>

        <footer className="canvas-compose-dialog-foot">
          <span>原图保留 · 结果会自动连接到组内图片</span>
          <div>
            <button type="button" onClick={onClose} disabled={busy}>取消</button>
            <button type="button" className="primary" onClick={() => void confirm()} disabled={busy || sources.length < 2}>
              {busy ? "拼接中…" : "确认拼接"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

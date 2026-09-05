"use client";

import { useEffect, useMemo, useState } from "react";
import {
  gridCompositeLayout,
  type CanvasImageGridCompositeOptions,
} from "@/lib/canvas/image-operations";

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
};

const CELL_SIZE_MIN = 256;
const CELL_SIZE_MAX = 2048;
const MAX_EDGE_MIN = 2048;
const MAX_EDGE_MAX = 6144;

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

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_SETTINGS });
    setBusy(false);
    setError("");
  }, [open, groupName]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
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
  const background = settings.background || "#ffffff";
  const previewBackground = background === "transparent" ? undefined : background;

  if (!open) return null;

  const update = <K extends keyof CanvasGroupComposeSettings>(
    key: K,
    value: CanvasGroupComposeSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const resetSettings = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    setError("");
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await onConfirm(settings);
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
          <div
            className={`canvas-compose-preview ${background === "transparent" ? "transparent" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gap: `${Math.min(24, Math.max(0, layout.gap / 4))}px`,
            }}
            aria-label={`宫格预览 ${layout.columns} 列 ${layout.rows} 行`}
          >
            {previewSources.map((source) => (
              <div
                className="canvas-compose-preview-cell"
                key={source.id}
                style={{ background: previewBackground }}
              >
                <img src={source.url} alt={source.name} style={{ objectFit: settings.fit }} />
              </div>
            ))}
          </div>

          <div className="canvas-compose-summary">
            <span><b>{layout.columns} × {layout.rows}</b><small>布局</small></span>
            <span><b>{layout.width} × {layout.height}</b><small>输出尺寸</small></span>
            <span><b>{Math.round(layout.scale * 100)}%</b><small>缩放</small></span>
          </div>

          <div className="canvas-compose-fields">
            <label className="canvas-compose-field-wide">
              <span>图片顺序 <em>影响拼接后的阅读顺序</em></span>
              <span className="canvas-compose-select-shell">
                <select aria-label="图片顺序" value={settings.order} onChange={(event) => update("order", event.target.value as CanvasGroupComposeOrder)}>
                  <option value="canvas">按画布阅读顺序</option>
                  <option value="group">按组内加入顺序</option>
                </select>
              </span>
            </label>
            <label>
              <span>列数 <em>{settings.columns ? "手动" : "推荐"}</em></span>
              <span className="canvas-compose-select-shell">
                <select aria-label="列数" value={settings.columns ?? "auto"} onChange={(event) => update("columns", event.target.value === "auto" ? undefined : Number(event.target.value))}>
                  <option value="auto">自动（接近方阵）</option>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                    <option value={value} key={value}>{value} 列</option>
                  ))}
                </select>
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
              <div className="canvas-compose-segmented" role="group" aria-label="图片适配">
                <button type="button" aria-pressed={settings.fit === "contain"} className={settings.fit === "contain" ? "active" : ""} onClick={() => update("fit", "contain")}>
                  <b>完整显示</b><small>不裁切</small>
                </button>
                <button type="button" aria-pressed={settings.fit === "cover"} className={settings.fit === "cover" ? "active" : ""} onClick={() => update("fit", "cover")}>
                  <b>铺满单格</b><small>允许裁切</small>
                </button>
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
                <select aria-label="背景" value={backgroundPreset(settings.background)} onChange={(event) => {
                  const value = event.target.value;
                  update("background", value === "white" ? "#ffffff" : value === "black" ? "#000000" : value === "transparent" ? "transparent" : backgroundPreset(settings.background) === "custom" ? settings.background || "#e5e7eb" : "#e5e7eb");
                }}>
                  <option value="white">白色</option>
                  <option value="black">黑色</option>
                  <option value="transparent">透明</option>
                  <option value="custom">自定义颜色</option>
                </select>
                {backgroundPreset(settings.background) === "custom" && <input className="canvas-compose-color" type="color" value={settings.background || "#e5e7eb"} onChange={(event) => update("background", event.target.value)} aria-label="自定义背景颜色" />}
              </span>
            </label>
          </div>

          {layout.scale < 1 && <p className="canvas-compose-hint">当前布局超过输出边长上限，导出时会自动缩小到 {layout.width} × {layout.height}。</p>}
          {error && <p className="canvas-compose-error" role="alert">{error}</p>}
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

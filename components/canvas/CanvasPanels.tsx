"use client";

import { useEffect, type ReactNode, type RefObject } from "react";
import type { CanvasConnectionStyle } from "@/lib/canvas/types";
import SelectMenu from "@/components/SelectMenu";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { DEPTH_QUALITY_OPTIONS, type DepthQuality } from "@/lib/canvas/depth-settings";

type ConnectionStyle = CanvasConnectionStyle;
type CanvasTheme = "light" | "dark";

function ConnectionOptionIcon({
  value,
}: {
  value: ConnectionStyle;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {value === "curve" ? (
        <path d="M3 16c4 0 4-8 9-8s5 8 9 8" />
      ) : value === "straight" ? (
        <path d="m4 18 16-12" />
      ) : (
        <path d="M3 17h7V7h11" />
      )}
    </svg>
  );
}

export const CONNECTION_STYLE_OPTIONS: Array<{
  value: ConnectionStyle;
  label: string;
  description: string;
}> = [
  {
    value: "curve",
    label: "平滑曲线",
    description: "柔和的贝塞尔曲线，适合自由画布",
  },
  {
    value: "straight",
    label: "直线",
    description: "端口之间直接连接，路径最短",
  },
  {
    value: "orthogonal",
    label: "直角折线",
    description: "水平与垂直走线，适合流程图",
  },
];

export const CANVAS_SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Esc"], label: "关闭弹层、取消当前操作并清除选择" },
  { keys: ["左键"], label: "拖动空白区域框选节点" },
  { keys: ["双击左键"], label: "打开创建节点菜单" },
  { keys: ["右键"], label: "打开画布操作菜单" },
  { keys: ["中键"], label: "拖动平移画布" },
  { keys: ["Space", "左键"], label: "按住 Space 拖动空白区域平移画布" },
  { keys: ["Shift", "左键"], label: "追加选择节点或对象组" },
  { keys: ["Ctrl/Cmd"], label: "按住并拖拽框选节点" },
  { keys: ["Ctrl", "G"], label: "合并选中的图片为组" },
  { keys: ["Ctrl", "Shift", "G"], label: "释放选中的分组" },
  { keys: ["Ctrl", "Z"], label: "撤销上一步操作" },
  { keys: ["Ctrl", "Shift", "Z"], label: "恢复上一步操作" },
  { keys: ["Ctrl", "C"], label: "复制选中的节点" },
  { keys: ["Ctrl", "V"], label: "粘贴节点或剪贴板图片" },
  { keys: ["Ctrl", "D"], label: "复制选中的节点" },
  {
    keys: ["Delete"],
    label: "删除选中的节点或连线；输入框内 Backspace 编辑文字",
  },
  { keys: ["Alt"], label: "按住并拖动复制节点" },
  { keys: ["Alt", "Shift"], label: "复制节点并保留输入连线" },
  { keys: ["A"], label: "打开/关闭资产库" },
  { keys: ["Z"], label: "适应画布视图" },
  { keys: ["+", "="], label: "放大画布视图" },
  { keys: ["-"], label: "缩小画布视图" },
  { keys: ["Ctrl", "Enter"], label: "执行当前生成任务" },
  { keys: ["Ctrl", "K"], label: "打开 Agent 助手并聚焦输入框，选中的节点会作为上下文" },
];

export function CanvasPanelShell({ title, subtitle, onClose, children, className = "", bodyRef }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; className?: string; bodyRef?: RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  /* The right-hand slot is a dock rather than a modal: CSS drops the scrim and
     its click-outside close so the topbar can switch panels in one click. */
  return <div className="canvas-modal-backdrop canvas-panel-backdrop">
    <aside className={`canvas-side-panel ${className}`}>
      <header><div><b>{title}</b><small>{subtitle}</small></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}>×</button></header>
      <div ref={bodyRef} className="canvas-side-panel-body">{children}</div>
    </aside>
  </div>;
}

export function CanvasSettingsPanel({ theme, connectionStyle, depthQuality, onTheme, onConnectionStyleChange, onDepthQualityChange, onExportWorkflow, onImportWorkflow, onClose }: { theme: CanvasTheme; connectionStyle: ConnectionStyle; depthQuality: DepthQuality; onTheme: () => void; onConnectionStyleChange: (value: ConnectionStyle) => void; onDepthQualityChange: (value: DepthQuality) => void; onExportWorkflow: () => void; onImportWorkflow: () => void; onClose: () => void }) {
  return <CanvasPanelShell title="画布设置" subtitle="只保留画布与应用配置" onClose={onClose} className="canvas-settings-panel">
    <section className="canvas-setting-section"><b>界面主题</b><button type="button" onClick={onTheme}>{theme === "light" ? "☾ 切换深色" : "☀ 切换浅色"}</button></section>
    <section className="canvas-setting-section"><b>连线样式</b><SelectMenu value={connectionStyle} portalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onConnectionStyleChange} ariaLabel="连线样式" options={CONNECTION_STYLE_OPTIONS.map((item) => ({ value: item.value, label: item.label, icon: <ConnectionOptionIcon value={item.value} /> }))} /></section>
    <section className="canvas-setting-section"><b>深度图性能</b><SelectMenu value={depthQuality} portalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onDepthQualityChange} ariaLabel="深度图性能档位" options={DEPTH_QUALITY_OPTIONS} /></section>
    <section className="canvas-setting-section"><b>导出工作流</b><button type="button" onClick={onExportWorkflow}>导出 JSON</button></section>
    <section className="canvas-setting-section"><b>导入工作流</b><button type="button" onClick={onImportWorkflow}>选择 JSON 文件</button></section>
  </CanvasPanelShell>;
}

export function CanvasShortcutsPanel({ onClose }: { onClose: () => void }) {
  return <CanvasPanelShell title="快捷键" subtitle="画布常用操作" onClose={onClose} className="canvas-shortcuts-panel">
    <div className="canvas-shortcuts-list">{CANVAS_SHORTCUTS.map((item, index) => <div key={`${item.label}-${index}`}><span>{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span><p>{item.label}</p></div>)}</div>
  </CanvasPanelShell>;
}

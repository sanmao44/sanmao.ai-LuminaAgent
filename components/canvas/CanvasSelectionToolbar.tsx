"use client";

import AgentOrb, { busyOrbState } from "@/components/AgentOrb";
import type { CanvasAlignment, CanvasDistribution } from "@/lib/canvas/model";

export type CanvasLayoutIconKind = CanvasAlignment | CanvasDistribution;

export type CanvasLayoutOption<T extends string> = {
  value: T;
  label: string;
  title: string;
  icon: CanvasLayoutIconKind;
};

export function CanvasLayoutIcon({ kind }: { kind: CanvasLayoutIconKind }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {kind === "left" && <><path d="M5 4v16" /><path d="M8 7h11M8 12h7M8 17h11" /></>}
      {kind === "center-x" && <><path d="M12 4v16" strokeDasharray="2 2" /><path d="M5 7h14M7 12h10M5 17h14" /></>}
      {kind === "right" && <><path d="M19 4v16" /><path d="M5 7h11M9 12h7M5 17h11" /></>}
      {kind === "top" && <><path d="M4 5h16" /><path d="M7 8v11M12 8v7M17 8v11" /></>}
      {kind === "center-y" && <><path d="M4 12h16" strokeDasharray="2 2" /><path d="M7 5v14M12 7v10M17 5v14" /></>}
      {kind === "bottom" && <><path d="M4 19h16" /><path d="M7 5v11M12 9v7M17 5v11" /></>}
      {kind === "horizontal" && <><rect x="4" y="8" width="3" height="8" rx="1" /><rect x="10.5" y="8" width="3" height="8" rx="1" /><rect x="17" y="8" width="3" height="8" rx="1" /><path d="M7 19h3.5M13.5 19H17" /></>}
      {kind === "vertical" && <><rect x="8" y="4" width="8" height="3" rx="1" /><rect x="8" y="10.5" width="8" height="3" rx="1" /><rect x="8" y="17" width="8" height="3" rx="1" /><path d="M19 7v3.5M19 13.5V17" /></>}
    </svg>
  );
}

export default function CanvasSelectionToolbar({
  selectedCount,
  selectedImageCount,
  batchDownloading,
  agentBusy,
  alignmentOptions,
  distributionOptions,
  onAskAgent,
  onMakeGroup,
  onDownloadSelectedImages,
  onArrange,
  onDuplicate,
  onFit,
  onDelete,
  onAlign,
  onDistribute,
}: {
  selectedCount: number;
  selectedImageCount: number;
  batchDownloading: boolean;
  agentBusy: boolean;
  alignmentOptions: readonly CanvasLayoutOption<CanvasAlignment>[];
  distributionOptions: readonly CanvasLayoutOption<CanvasDistribution>[];
  onAskAgent: () => void;
  onMakeGroup: () => void;
  onDownloadSelectedImages: () => void;
  onArrange: () => void;
  onDuplicate: () => void;
  onFit: () => void;
  onDelete: () => void;
  onAlign: (value: CanvasAlignment) => void;
  onDistribute: (value: CanvasDistribution) => void;
}) {
  if (selectedCount < 2) return null;
  return (
    <>
      <div className="canvas-selection-toolbar" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <b>{`已选 ${selectedCount} 个对象`}</b>
        <span />
        <button type="button" title="打开 Agent 助手，用这些选中节点作为上下文" onClick={onAskAgent}>
          <AgentOrb state={busyOrbState(agentBusy)} size={13} label="" />
          问 Agent
        </button>
        <button type="button" onClick={onMakeGroup}>⌘ 成组</button>
        {selectedImageCount >= 2 && (
          <button type="button" title="按选择顺序打包下载图片" aria-label={`批量下载 ${selectedImageCount} 张图片`} disabled={batchDownloading} onClick={onDownloadSelectedImages}>
            {batchDownloading ? "⌛ 打包中…" : `↓ 下载 ${selectedImageCount} 张`}
          </button>
        )}
        <button type="button" onClick={onArrange} title="按节点父子关系整理选中对象">⌗ 整理选中</button>
        <button type="button" onClick={onDuplicate}>⧉ 复制</button>
        <button type="button" onClick={onFit}>⌗ 聚焦</button>
        <button type="button" className="danger" onClick={onDelete}>⌫ 删除</button>
      </div>
      <div className="canvas-selection-layout-toolbar" aria-label="节点布局工具" onPointerDown={(event) => event.stopPropagation()}>
        <div className="canvas-selection-layout-group alignment" aria-label="节点对齐">
          {alignmentOptions.map((option) => (
            <span className="canvas-selection-layout-tooltip" data-tooltip={option.title} key={option.value}>
              <button type="button" title={option.title} aria-label={option.title} onClick={() => onAlign(option.value)}>
                <CanvasLayoutIcon kind={option.icon} />
              </button>
            </span>
          ))}
        </div>
        <span className="canvas-selection-layout-divider" aria-hidden="true" />
        <div className="canvas-selection-layout-group distribution" aria-label="节点均匀分布">
          {distributionOptions.map((option) => {
            const disabled = selectedCount < 3;
            const tooltip = disabled ? `至少选择 3 个节点后可${option.label}` : option.title;
            return (
              <span className="canvas-selection-layout-tooltip" data-tooltip={tooltip} key={option.value}>
                <button type="button" title={tooltip} aria-label={tooltip} disabled={disabled} onClick={() => onDistribute(option.value)}>
                  <CanvasLayoutIcon kind={option.icon} />
                </button>
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}

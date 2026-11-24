"use client";

import type { MouseEventHandler } from "react";

export type CanvasEmptyStateProps = {
  visible: boolean;
  onImport: () => void;
  onOpenCreateMenu: (clientX: number, clientY: number) => void;
  onAskAgent: () => void;
};

export default function CanvasEmptyState({
  visible,
  onImport,
  onOpenCreateMenu,
  onAskAgent,
}: CanvasEmptyStateProps) {
  if (!visible) return null;

  const handleAction = (action: () => void): MouseEventHandler<HTMLButtonElement> => (event) => {
    event.stopPropagation();
    action();
  };

  const handleOpenCreateMenu: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    onOpenCreateMenu(event.clientX, event.clientY);
  };

  return (
    <section className="canvas-empty-state" role="region" aria-labelledby="canvas-empty-state-title">
      <div className="canvas-empty-state-panel">
        <span className="canvas-empty-state-mark" aria-hidden="true">✦</span>
        <h2 id="canvas-empty-state-title">从一个节点开始</h2>
        <p>导入素材、创建节点，或让 Agent 帮你起稿。</p>
        <div className="canvas-empty-state-actions" role="group" aria-label="画布开始方式">
          <button type="button" className="canvas-empty-state-action is-primary" onClick={handleAction(onImport)}>
            <span className="canvas-empty-state-action-icon" aria-hidden="true">↥</span>
            <span>导入素材</span>
          </button>
          <button type="button" className="canvas-empty-state-action" onClick={handleOpenCreateMenu}>
            <span className="canvas-empty-state-action-icon" aria-hidden="true">＋</span>
            <span>创建节点</span>
          </button>
          <button type="button" className="canvas-empty-state-action" onClick={handleAction(onAskAgent)}>
            <span className="canvas-empty-state-action-icon" aria-hidden="true">✧</span>
            <span>让 Agent 起稿</span>
          </button>
        </div>
      </div>
    </section>
  );
}

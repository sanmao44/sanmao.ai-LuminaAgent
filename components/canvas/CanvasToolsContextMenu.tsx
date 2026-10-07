"use client";

import AgentOrb from "@/components/AgentOrb";
import { CanvasContextMenuFrame } from "@/components/canvas/CanvasContextMenu";

export type CanvasToolsContextMenuPosition = {
  x: number;
  y: number;
  world: { x: number; y: number };
};

export type CanvasToolsContextMenuProps = {
  position: CanvasToolsContextMenuPosition;
  canUndo: boolean;
  canRedo: boolean;
  emptyContentCount: number;
  onClose: () => void;
  onAskAgent: () => void;
  onUpload: (position: { x: number; y: number }) => void;
  onOpenCreate: () => void;
  onPaste: (position: { x: number; y: number }) => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onArrange: () => void;
  onFit: () => void;
  onClean: () => void;
};

/** Owns the blank-canvas tools menu presentation; Workspace keeps every action implementation. */
export default function CanvasToolsContextMenu({
  position,
  canUndo,
  canRedo,
  emptyContentCount,
  onClose,
  onAskAgent,
  onUpload,
  onOpenCreate,
  onPaste,
  onUndo,
  onRedo,
  onArrange,
  onFit,
  onClean,
}: CanvasToolsContextMenuProps) {
  return (
<CanvasContextMenuFrame
  key="tools"
  className="canvas-tools-context-menu"
  position={position}
  ariaLabel="画布操作菜单"
>
  <div className="canvas-menu-title">
    <span>画布操作</span>
  </div>
  <div className="canvas-context-menu-body">
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-agent"
      aria-keyshortcuts="Control+K"
      onClick={() => {
        onClose();
        onAskAgent();
      }}
    >
      <span className="canvas-menu-icon" aria-hidden="true"><AgentOrb state="idle" size={18} label="" /></span>
      <span className="canvas-menu-copy">
        <b>问 Agent</b>
      </span>
      <small className="canvas-menu-shortcut">Ctrl/Cmd + K</small>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        onUpload(position.world);
      }}
    >
      <span className="canvas-menu-icon" aria-hidden="true">⇧</span>
      <span className="canvas-menu-copy">
        <b>上传</b>
      </span>
      <span className="canvas-menu-arrow" aria-hidden="true">›</span>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-create"
      onClick={onOpenCreate}
    >
      <span className="canvas-menu-icon" aria-hidden="true">＋</span>
      <span className="canvas-menu-copy">
        <b>添加节点</b>
      </span>
      <span className="canvas-menu-arrow" aria-hidden="true">›</span>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        void onPaste(position.world);
      }}
    >
      <span className="canvas-menu-icon" aria-hidden="true">⌘</span>
      <span className="canvas-menu-copy">
        <b>粘贴</b>
      </span>
      <small className="canvas-menu-shortcut">Ctrl/Cmd + V</small>
    </button>
    <div className="canvas-menu-divider" role="separator" aria-hidden="true" />
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        onUndo();
      }}
      disabled={!canUndo}
    >
      <span className="canvas-menu-icon" aria-hidden="true">↶</span>
      <span className="canvas-menu-copy">
        <b>撤销</b>
      </span>
      <small className="canvas-menu-shortcut">Ctrl/Cmd + Z</small>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        onRedo();
      }}
      disabled={!canRedo}
    >
      <span className="canvas-menu-icon" aria-hidden="true">↷</span>
      <span className="canvas-menu-copy">
        <b>重做</b>
      </span>
      <small className="canvas-menu-shortcut">Ctrl/Cmd + Shift + Z</small>
    </button>
    <div className="canvas-menu-divider" role="separator" aria-hidden="true" />
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        onArrange();
      }}
    >
      <span className="canvas-menu-icon" aria-hidden="true">⌗</span>
      <span className="canvas-menu-copy">
        <b>一键整理</b>
      </span>
      <span className="canvas-menu-arrow" aria-hidden="true">›</span>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool"
      onClick={() => {
        onClose();
        onFit();
      }}
    >
      <span className="canvas-menu-icon" aria-hidden="true">⛶</span>
      <span className="canvas-menu-copy">
        <b>适应视图</b>
      </span>
      <small className="canvas-menu-shortcut">Z</small>
    </button>
    <button
      type="button"
      className="canvas-menu-item canvas-menu-item-tool canvas-menu-item-danger"
      onClick={() => {
        onClose();
        onClean();
      }}
      disabled={!emptyContentCount}
      title="删除没有实际内容的节点，包括已连线节点；可通过撤销恢复"
    >
      <span className="canvas-menu-icon" aria-hidden="true">⌫</span>
      <span className="canvas-menu-copy">
        <b>清理空内容（{emptyContentCount}）</b>
      </span>
    </button>
  </div>
</CanvasContextMenuFrame>
  );
}

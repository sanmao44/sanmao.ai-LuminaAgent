"use client";

import AgentOrb from "@/components/AgentOrb";
import { CanvasContextMenuFrame } from "@/components/canvas/CanvasContextMenu";
import type { CanvasNodeCreationKind } from "@/lib/canvas/types";

export type CanvasCreateContextMenuProps = {
  position: { x: number; y: number; world: { x: number; y: number } };
  onClose: () => void;
  onCreateNode: (type: CanvasNodeCreationKind, world: { x: number; y: number }) => void;
  onOpenClone: () => void;
};

/** Owns the blank-canvas node creation menu presentation and callback wiring. */
export default function CanvasCreateContextMenu({
  position,
  onClose,
  onCreateNode,
  onOpenClone,
}: CanvasCreateContextMenuProps) {
  const create = (type: CanvasNodeCreationKind) => () => {
    onClose();
    onCreateNode(type, position.world);
  };
  return (
    <CanvasContextMenuFrame
      key="create"
      className="canvas-create-context-menu"
      position={position}
      ariaLabel="创建节点菜单"
    >
      <div className="canvas-menu-title">
        <span>创建节点</span>
        <small>选择节点放置到双击位置</small>
      </div>
      <div className="canvas-context-menu-body">
        <div className="canvas-menu-group">
          <button type="button" className="canvas-menu-item canvas-menu-item-image" onClick={create("image")}>
            <span className="canvas-menu-icon" aria-hidden="true">▧</span>
            <span className="canvas-menu-copy"><b>空图片节点</b><small>结果直接写入节点</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-video" onClick={create("video")}>
            <span className="canvas-menu-icon" aria-hidden="true">▶</span>
            <span className="canvas-menu-copy"><b>空视频节点</b><small>结果直接写入节点</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-audio" onClick={create("audio")}>
            <span className="canvas-menu-icon" aria-hidden="true">♫</span>
            <span className="canvas-menu-copy"><b>音频节点</b><small>导入后连接到视频作为参考音频</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-video-editor" onClick={create("videoEditor")}>
            <span className="canvas-menu-icon" aria-hidden="true">✂</span>
            <span className="canvas-menu-copy"><b>视频编辑节点</b><small>多轨剪辑、裁剪、分割和字幕</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-clone" onClick={() => { onClose(); onOpenClone(); }}>
            <span className="canvas-menu-icon" aria-hidden="true">✦</span>
            <span className="canvas-menu-copy"><b>克隆出片</b><small>拆解参考视频节奏，重新生成整片</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-agent" onClick={create("text")}>
            <span className="canvas-menu-icon" aria-hidden="true"><AgentOrb state="idle" size={18} label="" /></span>
            <span className="canvas-menu-copy"><b>Agent 节点</b><small>文本驱动智能工作流</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
        </div>
        <button type="button" className="canvas-menu-item canvas-menu-item-tool" onClick={create("upscale")}>
          <span className="canvas-menu-icon" aria-hidden="true">↗</span>
          <span className="canvas-menu-copy"><b>超分节点</b><small>连接图片后在独立面板中提交</small></span>
          <span className="canvas-menu-arrow" aria-hidden="true">›</span>
        </button>
        <div className="canvas-menu-group">
          <button type="button" className="canvas-menu-item canvas-menu-item-image" onClick={create("workflowImage")}>
            <span className="canvas-menu-icon" aria-hidden="true">✦</span>
            <span className="canvas-menu-copy"><b>图片变体生成器</b><small>多行要求批量生成</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="canvas-menu-item canvas-menu-item-video" onClick={create("workflowVideo")}>
            <span className="canvas-menu-icon" aria-hidden="true">▶</span>
            <span className="canvas-menu-copy"><b>视频变体生成器</b><small>多行要求串行生成</small></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </CanvasContextMenuFrame>
  );
}

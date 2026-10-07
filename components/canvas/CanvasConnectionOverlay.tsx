"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CanvasNodeCreationKind } from "@/lib/canvas/types";

export type CanvasConnectionPoint = { x: number; y: number };
export type CanvasConnectionNodePicker = {
  x: number;
  y: number;
  world: CanvasConnectionPoint;
  sourceId: string;
  sourcePort: "left" | "right";
};
export type CanvasConnectionNodeOption = {
  kind: CanvasNodeCreationKind;
  icon: string;
  label: string;
  description: string;
};

export const CONNECTION_NODE_OPTIONS: readonly CanvasConnectionNodeOption[] = [
  { kind: "image", icon: "✦", label: "图片节点", description: "连接到图片生成节点" },
  { kind: "video", icon: "▶", label: "视频节点", description: "连接到视频生成节点" },
  { kind: "audio", icon: "♫", label: "音频节点", description: "作为视频生成的参考音频" },
  { kind: "text", icon: "T", label: "Agent 节点", description: "连接对话上下文并调用对话模型" },
  { kind: "upscale", icon: "↗", label: "超分节点", description: "连接一张已完成图片并打开超分设置" },
  { kind: "workflowImage", icon: "✧", label: "图片变体生成器", description: "按多条要求批量生成图片变体" },
  { kind: "workflowVideo", icon: "◆", label: "视频变体生成器", description: "按多条要求串行生成视频变体" },
  { kind: "videoEditor", icon: "✂", label: "视频编辑节点", description: "连接素材并打开多轨编辑工作台" },
];

type ConnectionTarget = { screen: CanvasConnectionPoint; width: number; height: number };
type ConnectionCancel = { screen: CanvasConnectionPoint; edgeId: string | null };
export type CanvasConnectionOverlayProps = {
  target: ConnectionTarget | null;
  cancel: ConnectionCancel | null;
  picker: { value: CanvasConnectionNodePicker; screen: CanvasConnectionPoint } | null;
  onCancelPointerEnter: () => void;
  onCancelPointerLeave: () => void;
  onCancelPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClosePicker: () => void;
  onSelectNode: (kind: CanvasNodeCreationKind, picker: CanvasConnectionNodePicker) => void;
};

export default function CanvasConnectionOverlay({
  target, cancel, picker, onCancelPointerEnter, onCancelPointerLeave,
  onCancelPointerDown, onClosePicker, onSelectNode,
}: CanvasConnectionOverlayProps) {
  return (
    <>
      {target && <div className="canvas-connection-target" style={{ left: target.screen.x - 8, top: target.screen.y - 8, width: target.width + 16, height: target.height + 16 }} />}
      {cancel && <button type="button" className={`canvas-connection-cancel${cancel.edgeId ? " canvas-connection-remove" : ""}`} aria-label={cancel.edgeId ? "删除此连线" : "取消连线"} title={cancel.edgeId ? "删除此连线" : "取消连线"} style={{ left: cancel.screen.x, top: cancel.screen.y }} onPointerEnter={onCancelPointerEnter} onPointerLeave={onCancelPointerLeave} onPointerDown={onCancelPointerDown}>×</button>}
      {picker && <div className="canvas-connection-picker" style={{ left: picker.screen.x, top: picker.screen.y } satisfies CSSProperties} onPointerDown={(event) => event.stopPropagation()}>
        <div className="canvas-connection-picker-head"><div><b>选择连接节点</b><small>松开后自动创建并连接</small></div><button type="button" aria-label="关闭节点选择" onClick={onClosePicker}>×</button></div>
        <div className="canvas-connection-picker-options">{CONNECTION_NODE_OPTIONS.map((option) => <button type="button" key={option.kind} onClick={() => onSelectNode(option.kind, picker.value)}><span>{option.icon}</span><i><b>{option.label}</b><small>{option.description}</small></i><em>›</em></button>)}</div>
      </div>}
    </>
  );
}

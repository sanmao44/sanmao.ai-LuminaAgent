"use client";

import ThreeDModelPreview from "@/components/ThreeDModelPreview";
import type { CanvasNode } from "@/lib/canvas/types";
import { canvasThreeDPreviewUrl } from "@/lib/canvas/three-d-generation";
import CanvasInlineNameEditor from "@/components/canvas/CanvasInlineNameEditor";

export default function CanvasThreeDNodeCard({
  node,
  pending,
  failed,
  processingLabel,
  onRename,
  renaming,
  onRenamingChange,
}: {
  node: CanvasNode;
  pending: boolean;
  failed: boolean;
  processingLabel: string;
  onRename?: (value: string) => void;
  renaming?: boolean;
  onRenamingChange?: (editing: boolean) => void;
}) {
  const task = node.data.threeDTask;
  const output = task?.outputs.find((item) => item.artifactType === "glb" || /\.glb(?:$|\?)/i.test(item.url || ""));
  const outputIndex = output ? task?.outputs.indexOf(output) ?? -1 : -1;
  const previewUrl = task && outputIndex >= 0 ? canvasThreeDPreviewUrl(task.id, outputIndex) : "";
  const status = pending ? processingLabel : failed ? "生成失败" : task?.status === "succeeded" ? "三维模型结果" : "等待配置";

  return (
    <div className="canvas-media-card three-d">
      <div className="canvas-media-stage canvas-three-d-stage">
        {pending ? (
          <div className="canvas-media-state pending"><span className="canvas-three-d-glyph" aria-hidden="true">◇</span><b>{processingLabel}</b><small>任务完成后会在此显示模型预览</small></div>
        ) : failed ? (
          <div className="canvas-media-state failed"><span>!</span><b>生成失败</b><small>{node.data.statusLabel || task?.error || "请打开面板重试"}</small></div>
        ) : previewUrl ? (
          <ThreeDModelPreview url={previewUrl} label={output?.name || "三维模型"} />
        ) : (
          <div className="canvas-media-state draft"><span className="canvas-three-d-glyph" aria-hidden="true">◇</span><b>三维模型节点</b><small>{task ? "任务已完成，暂无 GLB 预览" : "选中后配置模型并生成"}</small></div>
        )}
      </div>
      <div className="canvas-node-footer">
        <span className="canvas-type-icon canvas-three-d-icon" aria-hidden="true">◇</span>
        <span className="canvas-node-title">
          <CanvasInlineNameEditor
            value={node.data.name}
            fallback="三维模型"
            ariaLabel="节点名称"
            onCommit={onRename}
            editing={renaming}
            onEditingChange={onRenamingChange}
            className="canvas-inline-name-editor canvas-node-name"
          />
          <small>{task?.modelName || "三维生成"}</small>
        </span>
        <em className="three-d-status">{status}</em>
      </div>
    </div>
  );
}

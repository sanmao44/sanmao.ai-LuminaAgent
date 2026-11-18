"use client";

import { useEffect, useRef, useState } from "react";
import ThreeDModelPreview from "@/components/ThreeDModelPreview";
import { observeCanvasThreeDPreview } from "@/components/canvas/three-d-preview-visibility";
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (!previewUrl || pending || failed) {
      setNearViewport(false);
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    return observeCanvasThreeDPreview(stage, setNearViewport);
  }, [failed, pending, previewUrl]);

  return (
    <div className="canvas-media-card three-d">
      <div className="canvas-media-stage canvas-three-d-stage" ref={stageRef}>
        {pending ? (
          <div className="canvas-media-state pending"><span className="canvas-three-d-glyph" aria-hidden="true">◇</span><b>{processingLabel}</b><small>任务完成后会在此显示模型预览</small></div>
        ) : failed ? (
          <div className="canvas-media-state failed"><span>!</span><b>生成失败</b><small>{node.data.statusLabel || task?.error || "请打开面板重试"}</small></div>
        ) : previewUrl && nearViewport ? (
          <ThreeDModelPreview url={previewUrl} label={output?.name || "三维模型"} />
        ) : previewUrl ? (
          <div className="canvas-media-state draft"><span className="canvas-three-d-glyph" aria-hidden="true">◇</span><b>三维模型已就绪</b><small>进入可视区域后加载预览</small></div>
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

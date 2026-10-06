"use client";

import type { CanvasCamera } from "@/lib/canvas/types";
import type { CanvasSnapGuide } from "@/lib/canvas/snap";

export type CanvasViewportOverlayProps = {
  camera: CanvasCamera;
  fileDropActive: boolean;
  agentDropActive: boolean;
  referencePickerActive: boolean;
  cloneTask: { message: string; progress: number } | null;
  snapGuides: readonly CanvasSnapGuide[];
  onOpenCloneDialog: () => void;
};

/**
 * Owns transient viewport decoration and status presentation.
 *
 * The workspace remains the authority for drag state, reference picking,
 * clone task lifecycle, and snap calculation; this component only projects
 * those values into the existing canvas overlays.
 */
export default function CanvasViewportOverlay({
  camera,
  fileDropActive,
  agentDropActive,
  referencePickerActive,
  cloneTask,
  snapGuides,
  onOpenCloneDialog,
}: CanvasViewportOverlayProps) {
  return (
    <>
      {fileDropActive && (
        <div className="canvas-file-drop-hint" aria-hidden="true">
          <span>↥</span>
          <b>{agentDropActive ? "松开以把这张图放到画布上" : "松开以导入图片或视频"}</b>
        </div>
      )}
      {referencePickerActive && (
        <div className="canvas-hint canvas-reference-picker-hint" role="status" aria-live="polite">
          <span aria-hidden="true">⌁</span>
          <div>
            <b>正在选择参考素材</b>
            <small>点击画布中的可用节点选择参考；空白处可平移，按 Esc 取消</small>
          </div>
        </div>
      )}
      {cloneTask && (
        <button
          type="button"
          className="canvas-status-chip canvas-clone-chip"
          title={`克隆出片进行中：${cloneTask.message || "生成中"}，点击查看进度`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenCloneDialog();
          }}
        >
          <span aria-hidden="true" />
          <b>克隆出片</b>
          <small>{cloneTask.message || "生成中"}</small>
          <em>{Math.round(Math.max(0, Math.min(1, cloneTask.progress)) * 100)}%</em>
        </button>
      )}
      <div className="canvas-grid" />
      {snapGuides.length > 0 && (
        <div className="canvas-snap-guides" aria-hidden="true">
          {snapGuides.map((guide) => {
            const zoom = camera.zoom;
            if (guide.axis === "x") {
              return (
                <span
                  className="canvas-snap-guide x"
                  key={`${guide.axis}-${guide.targetId}`}
                  style={{
                    left: camera.x + guide.position * zoom,
                    top: camera.y + guide.start * zoom,
                    height: Math.max(1, (guide.end - guide.start) * zoom),
                  }}
                />
              );
            }
            return (
              <span
                className="canvas-snap-guide y"
                key={`${guide.axis}-${guide.targetId}`}
                style={{
                  left: camera.x + guide.start * zoom,
                  top: camera.y + guide.position * zoom,
                  width: Math.max(1, (guide.end - guide.start) * zoom),
                }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

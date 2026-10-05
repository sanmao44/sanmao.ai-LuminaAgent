"use client";

import type { CanvasNode, CanvasUpscaleParams } from "@/lib/canvas/types";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";

export type CanvasUpscaleNodeCardProps = {
  node: CanvasNode;
  pending: boolean;
  hasResult: boolean;
  processingLabel: string;
  processingProgress?: number;
  processingKind: CanvasProcessingKind;
  imageResolution: string | null;
  sourceConnected: boolean;
  onNaturalSize: (
    nodeId: string,
    width: number,
    height: number,
    durationSeconds?: number,
  ) => void;
};

export default function CanvasUpscaleNodeCard({
  node,
  pending,
  hasResult,
  processingLabel,
  processingProgress,
  processingKind,
  imageResolution,
  sourceConnected,
  onNaturalSize,
}: CanvasUpscaleNodeCardProps) {
  const data = node.data;
  const params = data.params as CanvasUpscaleParams | undefined;

  return (
    <div className={`canvas-upscale-card${hasResult ? " has-result" : ""}`}>
      <div className="canvas-upscale-card-head"><span>↗</span><div><b>图片超分</b><small>{hasResult ? "超分节点生成的结果" : "独立超分节点"}</small></div></div>
      {pending ? (
        <div className="canvas-upscale-card-loading">
          <CanvasProcessingIndicator
            label={processingLabel}
            progress={processingProgress}
            kind={processingKind}
            startedAt={data.processingStartedAt || data.generation?.createdAt}
            waiting={data.status === "queued"}
            compact
          />
        </div>
      ) : hasResult ? (
        <div className="canvas-upscale-card-result" title="双击查看大图；拖动此节点到其他节点可作为图片参考">
          <img
            src={String(data.url)}
            alt={String(data.name || "超分结果")}
            draggable={false}
            onLoad={(event) =>
              onNaturalSize(
                node.id,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              )
            }
          />
          <span className="canvas-upscale-result-badge"><i>↗</i>{data.status === "failed" ? "上次超分结果" : "超分节点生成的结果"}</span>
          {imageResolution && (
            <span
              className="canvas-image-resolution canvas-upscale-resolution"
              title={`图片分辨率 ${imageResolution}`}
              aria-label={`图片分辨率 ${imageResolution}`}
            >
              {imageResolution}
            </span>
          )}
        </div>
      ) : (
        <div className="canvas-upscale-card-preview"><strong>{String(params?.scale || 2)}×</strong><span>{String(params?.algorithm || "lanczos")}</span></div>
      )}
      <div className="canvas-upscale-card-status">{pending ? processingLabel : data.status === "failed" ? String(data.statusLabel || "超分失败，可重试") : hasResult ? "双击预览 · 拖到其他节点作为图片参考" : sourceConnected ? "已连接图片 · 选中后打开设置" : "请连接一张已完成的图片"}</div>
    </div>
  );
}

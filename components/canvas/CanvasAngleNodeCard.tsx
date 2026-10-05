import type {
  CanvasAngleParams,
  CanvasGenerationStatus,
  CanvasNode,
} from "@/lib/canvas/types";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";
import { canvasAngleCardStateLabel } from "@/components/canvas/angle-card-state";

export type CanvasAngleNodeCardProps = {
  angleReference?: CanvasNode;
  angleParams?: CanvasAngleParams;
  status: CanvasGenerationStatus;
  statusLabel?: string;
  pending: boolean;
  processingLabel: string;
  processingProgress?: number;
  processingKind: CanvasProcessingKind;
  processingStartedAt?: number;
  onOpenAngle: () => void;
  onCancelAngle: () => void;
};

export default function CanvasAngleNodeCard({
  angleReference,
  angleParams,
  status,
  statusLabel,
  pending,
  processingLabel,
  processingProgress,
  processingKind,
  processingStartedAt,
  onOpenAngle,
  onCancelAngle,
}: CanvasAngleNodeCardProps) {
  const hasReference = Boolean(angleReference);
  return (
    <div className="canvas-angle-card">
      <div className="canvas-angle-card-head">
        <span className="canvas-angle-card-icon" aria-hidden="true">◈</span>
        <div><b>角度控制</b><small>相机视角 · 主体 · 光影</small></div>
        <span className={`canvas-angle-card-state ${status}`}>
          {canvasAngleCardStateLabel(status, pending, hasReference)}
        </span>
      </div>
      {pending ? (
        <CanvasProcessingIndicator
          label={processingLabel}
          progress={processingProgress}
          kind={processingKind}
          startedAt={processingStartedAt}
          waiting={status === "queued"}
          compact
        />
      ) : angleReference?.data.url ? (
        <div className="canvas-angle-card-reference">
          <img
            src={String(angleReference.data.url)}
            alt={String(angleReference.data.name || "角度参考图")}
            draggable={false}
          />
          <span>参考图</span>
        </div>
      ) : (
        <div className="canvas-angle-card-empty"><b>连接一张已完成图片</b><small>角度节点只接受单张图片输入</small></div>
      )}
      <div className="canvas-angle-card-summary">
        <span>机位 {angleParams ? `${Math.round(angleParams.camera.yaw)}° / ${Math.round(angleParams.camera.pitch)}°` : "原图"}</span>
        <span>{angleParams?.subjectType || "通用主体"}</span>
        <span>{angleParams?.lighting?.enabled ? "自定义灯光" : "原始光照"}</span>
      </div>
      {status === "failed" && <small className="canvas-angle-card-error">{String(statusLabel || "生成失败，可重试")}</small>}
      <div className="canvas-angle-card-actions">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onOpenAngle(); }}
        >
          {status === "failed" ? "重试 / 编辑" : "打开工作台"}
        </button>
        {pending && (
          <button
            type="button"
            className="danger"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onCancelAngle(); }}
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}

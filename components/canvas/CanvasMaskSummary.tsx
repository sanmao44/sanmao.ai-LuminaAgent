import type { CanvasMaskState } from "@/lib/canvas/types";
import { canvasMaskStatusLabel } from "@/lib/canvas/mask";

export type CanvasMaskSummaryProps = {
  mask: CanvasMaskState;
  onEdit: () => void;
  onRemove?: () => void;
};

export default function CanvasMaskSummary({
  mask,
  onEdit,
  onRemove,
}: CanvasMaskSummaryProps) {
  const annotationSummary = mask.annotations?.length
    ? ` · ${mask.annotations.length} 个标记`
    : "";
  const coverage = typeof mask.coverage === "number"
    ? `覆盖 ${Math.round(mask.coverage * 100)}%`
    : "覆盖范围待计算";
  return (
    <div className={`canvas-mask-summary ${mask.status}`} data-canvas-wheel-isolate>
      <button type="button" className="canvas-mask-summary-preview" onClick={onEdit} title="查看局部编辑范围并继续编辑">
        <span className="canvas-mask-thumb"><img src={mask.url} alt="局部编辑范围缩略图" /></span>
        <span>
          <b>局部编辑 · {canvasMaskStatusLabel(mask.status)}</b>
          <small>{coverage}{annotationSummary}{mask.error ? ` · ${mask.error}` : ""}</small>
        </span>
      </button>
      <div className="canvas-mask-summary-actions">
        <button type="button" onClick={onEdit}>{mask.status === "used" ? "再次使用" : "查看 / 编辑"}</button>
        {onRemove && <button type="button" className="danger" onClick={onRemove}>移除</button>}
      </div>
    </div>
  );
}

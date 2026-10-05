import type { CanvasNode, CanvasVariantState } from "@/lib/canvas/types";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";
import { CanvasGeneratorHelp } from "@/components/canvas/CanvasVariantEditors";

export type CanvasGeneratorNodeCardProps = {
  node: CanvasNode;
  kind: "image" | "video";
  status?: string;
  pending: boolean;
  processingLabel: string;
  processingProgress?: number;
  processingKind: CanvasProcessingKind;
  processingStartedAt?: number;
  generatorProgress?: number;
  referenceCount: number;
  variantRequirements: string[];
  variantStates: CanvasVariantState[];
  completedVariants: number;
  failedVariants: number;
  estimatedResultCount: number;
  editorOutputs: CanvasNode[];
  prompt?: string;
  model?: string;
  aspect?: string;
  onRetryVariant: (variantIndex: number) => void;
  onRetryFailedVariants: () => void;
  onOutputPreview: (node: CanvasNode) => void;
};

export function canvasVariantStatusLabel(status: CanvasVariantState["status"]) {
  return status === "running"
    ? "生成中"
    : status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : "等待中";
}

export default function CanvasGeneratorNodeCard({
  node,
  kind,
  status,
  pending,
  processingLabel,
  processingProgress,
  processingKind,
  processingStartedAt,
  generatorProgress,
  referenceCount,
  variantRequirements,
  variantStates,
  completedVariants,
  failedVariants,
  estimatedResultCount,
  editorOutputs,
  prompt,
  model,
  aspect,
  onRetryVariant,
  onRetryFailedVariants,
  onOutputPreview,
}: CanvasGeneratorNodeCardProps) {
  return (
    <div className="canvas-generator-card">
      <div className="canvas-generator-head">
        <span>{kind === "video" ? "▶" : "✦"}</span>
        <div className="canvas-generator-head-copy">
          <b>{kind === "video" ? "视频变体生成器" : "图片变体生成器"}</b>
          <small>
            {status === "running"
              ? "批量处理中…"
              : status === "failed"
                ? "有失败变体，可单独重试"
                : "共同提示词 + 逐条编辑、回车新增"}
          </small>
        </div>
        <CanvasGeneratorHelp kind={kind} />
      </div>
      {pending && (
        <CanvasProcessingIndicator
          label={processingLabel}
          progress={generatorProgress ?? processingProgress}
          kind={processingKind}
          startedAt={processingStartedAt}
          waiting={status === "queued"}
        />
      )}
      <div className="canvas-generator-summary">
        <span>参考素材 {referenceCount}</span>
        <span>变体 {variantRequirements.length}</span>
        <span>完成 {completedVariants}/{variantRequirements.length}</span>
        <span>{kind === "image" ? `预计 ${estimatedResultCount} 张` : `串行 ${variantRequirements.length} 项`}</span>
      </div>
      {failedVariants > 0 && (
        <button
          type="button"
          className="canvas-variant-retry-all"
          title={`重试全部失败变体（${failedVariants} 条）`}
          aria-label={`重试全部失败变体（${failedVariants} 条）`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRetryFailedVariants();
          }}
        >
          ↻ 重试失败项（{failedVariants}）
        </button>
      )}
      {editorOutputs.length > 0 && (
        <>
          <div className="canvas-generator-section-heading">
            <b>生成结果</b><small>{editorOutputs.length} 个输出</small>
          </div>
          <div className="canvas-generator-output-gallery" aria-label="生成结果">
            {editorOutputs.map((output) => (
              <button
                type="button"
                key={output.id}
                className="canvas-generator-output-thumb"
                draggable={Boolean(output.data.url)}
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-sanmao-canvas-node", output.id);
                }}
                onClick={() => onOutputPreview(output)}
                title="查看结果；可拖到其他节点作为参考"
              >
                {output.data.kind === "video" ? <video src={output.data.url} muted playsInline /> : <img src={output.data.url} alt={output.data.name || "生成结果"} />}
                <span>{output.data.name || "结果"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="canvas-generator-prompt">
        <div className="canvas-generator-prompt-heading">
          <b>共同提示词</b><small>所有变体都会使用</small>
        </div>
        <span>{String(prompt || "点击选中，在下方编辑提示词")}</span>
      </div>
      <div className="canvas-generator-section-heading">
        <b>变体要求</b><small>按顺序生成 · {variantRequirements.length} 条</small>
      </div>
      <div className="canvas-variant-state-list">
        {variantRequirements.map((instruction, index) => {
          const state = variantStates[index];
          return (
            <div className={`canvas-variant-state ${state?.status || "pending"}`} key={`${node.id}-variant-${index}`}>
              <span>{index + 1}</span>
              <p>{instruction || "默认变体"}</p>
              <small>{canvasVariantStatusLabel(state?.status || "pending")}</small>
              {state?.status === "failed" && (
                <button
                  type="button"
                  title={`重试第 ${index + 1} 条变体`}
                  aria-label={`重试第 ${index + 1} 条变体`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetryVariant(index);
                  }}
                >
                  重试
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="canvas-generator-meta">
        <span>{String(model || "自动模型")}</span>
        <span>{String(aspect || "自动比例")}</span>
      </div>
    </div>
  );
}

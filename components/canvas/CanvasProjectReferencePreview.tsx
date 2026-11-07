"use client";

import {
  planProjectVisualReferenceSubmission,
  type GenerationReference,
  type ProjectVisualReference,
  type ProjectVisualReferencePreviewItem,
} from "@/lib/canvas/project-visual-references";

export default function CanvasProjectReferencePreview({
  references,
  explicitReferences = [],
  excludedAssetIds,
  onToggle,
  mediaKind,
  maxReferences = 16,
  projectDefaultsEnabled = true,
  disabledReason,
}: {
  references: readonly ProjectVisualReference[];
  explicitReferences?: readonly GenerationReference[];
  excludedAssetIds: readonly string[];
  onToggle: (assetId: string, included: boolean) => void;
  mediaKind: "图片" | "视频";
  maxReferences?: number;
  projectDefaultsEnabled?: boolean;
  disabledReason?: string;
}) {
  if (!references.length) return null;
  const excluded = new Set(excludedAssetIds);
  const plan = planProjectVisualReferenceSubmission(
    explicitReferences,
    references,
    excludedAssetIds,
    maxReferences,
    projectDefaultsEnabled,
  );
  const statusLabel = (status: ProjectVisualReferencePreviewItem["status"]) => {
    if (status === "included") return "本次发送";
    if (status === "excluded") return "本次排除";
    if (status === "duplicate") return "已由连接参考提供";
    if (status === "defaults-disabled") return "本次不适用";
    return "未发送：模型上限";
  };
  return (
    <section className="canvas-project-reference-preview" aria-label={`本次${mediaKind}生成使用的项目参考`}>
      <div className="canvas-project-reference-preview-head">
        <div>
          <b>本次参考 · {plan.references.length}/{plan.limit}</b>
          <small>项目图 {plan.projectCount}/{references.length} · 显式参考优先</small>
        </div>
      </div>
      {disabledReason && <small className="canvas-project-reference-preview-note" role="status">{disabledReason}</small>}
      <div className="canvas-project-reference-preview-list">
        {plan.items.map(({ reference, status }) => {
          const included = !excluded.has(reference.assetId);
          const editable = status === "included" || status === "excluded";
          return (
            <label key={reference.assetId} className={`${included ? "included" : "excluded"} ${status}`} title={`${reference.name} · ${statusLabel(status)}`}>
              <input
                type="checkbox"
                checked={included}
                disabled={!editable}
                onChange={(event) => onToggle(reference.assetId, event.currentTarget.checked)}
                aria-label={`${statusLabel(status)}：${reference.name}`}
              />
              <img src={reference.url} alt="" loading="lazy" />
              <span>{reference.name}<small>{statusLabel(status)}</small></span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

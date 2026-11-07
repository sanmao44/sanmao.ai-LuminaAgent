"use client";

import {
  planProjectVisualReferenceSubmission,
  type GenerationReference,
  type ProjectVisualReference,
  type ProjectVisualReferenceMode,
  type ProjectVisualReferencePreviewItem,
} from "@/lib/canvas/project-visual-references";

export default function CanvasProjectReferencePreview({
  references,
  explicitReferences = [],
  excludedAssetIds,
  onToggle,
  mediaKind,
  maxReferences = 16,
  projectDefaultsMode = "included",
  modeNote,
}: {
  references: readonly ProjectVisualReference[];
  explicitReferences?: readonly GenerationReference[];
  excludedAssetIds: readonly string[];
  onToggle: (assetId: string, included: boolean) => void;
  mediaKind: "图片" | "视频";
  maxReferences?: number;
  projectDefaultsMode?: ProjectVisualReferenceMode;
  modeNote?: string;
}) {
  if (!references.length) return null;
  const excluded = new Set(excludedAssetIds);
  const plan = planProjectVisualReferenceSubmission(
    explicitReferences,
    references,
    excludedAssetIds,
    maxReferences,
    projectDefaultsMode,
  );
  const conditionalCount = plan.items.filter((item) => item.status === "conditional").length;
  const statusLabel = (status: ProjectVisualReferencePreviewItem["status"]) => {
    if (status === "included") return "本次发送";
    if (status === "excluded") return "本次排除";
    if (status === "duplicate") return "已由连接参考提供";
    if (status === "defaults-disabled") return "本次不适用";
    if (status === "conditional") return "待自动判断";
    return "未发送：模型上限";
  };
  return (
    <section className="canvas-project-reference-preview" aria-label={`${projectDefaultsMode === "conditional" ? "待自动判断的" : "本次使用的"}${mediaKind}项目参考`}>
      <div className="canvas-project-reference-preview-head">
        <div>
          <b>{projectDefaultsMode === "conditional" ? `明确参考 · ${plan.explicitCount}/${plan.limit}` : `本次参考 · ${plan.references.length}/${plan.limit}`}</b>
          <small>{projectDefaultsMode === "conditional" ? `项目图候选 ${conditionalCount} 张 · 按自动意图判断` : `项目图 ${plan.projectCount}/${references.length} · 显式参考优先`}</small>
        </div>
      </div>
      {modeNote && <small className="canvas-project-reference-preview-note" role="status">{modeNote}</small>}
      <div className="canvas-project-reference-preview-list">
        {plan.items.map(({ reference, status }) => {
          const included = !excluded.has(reference.assetId);
          const editable = status === "included" || status === "excluded" || status === "conditional";
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

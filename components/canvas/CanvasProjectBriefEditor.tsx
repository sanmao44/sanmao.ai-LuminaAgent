"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CREATIVE_PROJECT_DELIVERABLE_OPTIONS, type CreativeProjectBrief, type CreativeProjectDeliverable } from "@/packages/contracts/creative";
import type { ProjectVisualReference } from "@/lib/canvas/project-visual-references";

const EMPTY_BRIEF: CreativeProjectBrief = { intent: "", style: "", audience: "", constraints: "", deliverable: "auto" };

export default function CanvasProjectBriefEditor({
  brief,
  referenceAssetIds = [],
  referenceAssets = [],
  onRemoveReference,
  onSave,
}: {
  brief?: CreativeProjectBrief | null;
  referenceAssetIds?: readonly string[];
  referenceAssets?: readonly ProjectVisualReference[];
  onRemoveReference?: (assetId: string) => void;
  onSave: (value: CreativeProjectBrief) => boolean;
}) {
  const [draft, setDraft] = useState<CreativeProjectBrief>(brief || EMPTY_BRIEF);

  useEffect(() => setDraft(brief || EMPTY_BRIEF), [brief]);

  const changed = (draft.intent || "") !== (brief?.intent || "")
    || draft.style !== (brief?.style || "")
    || draft.audience !== (brief?.audience || "")
    || draft.constraints !== (brief?.constraints || "")
    || draft.deliverable !== (brief?.deliverable || "auto");
  const selectedDeliverable = CREATIVE_PROJECT_DELIVERABLE_OPTIONS.find((option) => option.value === (draft.deliverable || "auto"));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <details className="canvas-project-brief">
      <summary>项目创作设定</summary>
      <form onSubmit={submit}>
        <div className="canvas-project-reference-summary">
          <div>
            <span>项目默认参考</span>
            <small>{referenceAssetIds.length ? "普通生图优先附加；@引用、改图和模型上限可能影响本次使用" : "还没有默认参考图"}</small>
          </div>
          {referenceAssetIds.length > 0 && (
            <div className="canvas-project-reference-list">
              {referenceAssetIds.map((assetId) => {
                const asset = referenceAssets.find((item) => item.assetId === assetId);
                return (
                  <span key={assetId} className="canvas-project-reference-chip">
                    {asset?.url ? <img src={asset.url} alt="" /> : null}
                    <b>{asset?.name || "已保存参考图"}</b>
                    {onRemoveReference && <button type="button" aria-label={`移除${asset?.name || "项目参考图"}`} onClick={() => onRemoveReference(assetId)}>×</button>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <label>
          <span>创作意图</span>
          <textarea
            value={draft.intent || ""}
            maxLength={500}
            rows={3}
            placeholder="描述这次想完成什么，例如：为新款咖啡设计一组春季上新视觉"
            onChange={(event) => setDraft((value) => ({ ...value, intent: event.target.value }))}
          />
        </label>
        <label>
          <span>交付目标</span>
          <select
            value={draft.deliverable || "auto"}
            onChange={(event) => setDraft((value) => ({ ...value, deliverable: event.target.value as CreativeProjectDeliverable }))}
          >
            {CREATIVE_PROJECT_DELIVERABLE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
          <small>{selectedDeliverable?.description}</small>
        </label>
        <label>
          <span>风格</span>
          <textarea
            value={draft.style}
            maxLength={500}
            rows={2}
            placeholder="例如：克制写实、自然光、低饱和"
            onChange={(event) => setDraft((value) => ({ ...value, style: event.target.value }))}
          />
        </label>
        <label>
          <span>目标受众</span>
          <textarea
            value={draft.audience}
            maxLength={500}
            rows={2}
            placeholder="例如：关注户外生活的年轻家庭"
            onChange={(event) => setDraft((value) => ({ ...value, audience: event.target.value }))}
          />
        </label>
        <label>
          <span>必须遵守</span>
          <textarea
            value={draft.constraints}
            maxLength={500}
            rows={2}
            placeholder="例如：产品外观保持一致，不出现竞品标志"
            onChange={(event) => setDraft((value) => ({ ...value, constraints: event.target.value }))}
          />
        </label>
        <button type="submit" disabled={!changed}>保存设定</button>
      </form>
    </details>
  );
}

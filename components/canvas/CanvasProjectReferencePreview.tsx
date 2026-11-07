"use client";

import type { ProjectVisualReference } from "@/lib/canvas/project-visual-references";

export default function CanvasProjectReferencePreview({
  references,
  excludedAssetIds,
  onToggle,
  mediaKind,
}: {
  references: readonly ProjectVisualReference[];
  excludedAssetIds: readonly string[];
  onToggle: (assetId: string, included: boolean) => void;
  mediaKind: "图片" | "视频";
}) {
  if (!references.length) return null;
  const excluded = new Set(excludedAssetIds);
  const includedCount = references.filter((reference) => !excluded.has(reference.assetId)).length;
  return (
    <section className="canvas-project-reference-preview" aria-label={`本次${mediaKind}生成使用的项目参考`}>
      <div className="canvas-project-reference-preview-head">
        <div>
          <b>本次项目参考 · {includedCount}/{references.length}</b>
          <small>取消勾选只影响本次生成</small>
        </div>
      </div>
      <div className="canvas-project-reference-preview-list">
        {references.map((reference) => {
          const included = !excluded.has(reference.assetId);
          return (
            <label key={reference.assetId} className={included ? "included" : "excluded"} title={reference.name}>
              <input
                type="checkbox"
                checked={included}
                onChange={(event) => onToggle(reference.assetId, event.currentTarget.checked)}
                aria-label={`${included ? "本次使用" : "本次排除"}${reference.name}`}
              />
              <img src={reference.url} alt="" loading="lazy" />
              <span>{reference.name}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { SmartVariantSource } from "@/lib/canvas/model";
import type { SmartVariantPlan } from "@/lib/canvas/smart-variant";
import { smartVariantSourceUnits } from "@/lib/canvas/model";

export type CanvasSmartVariantDialogProps = {
  open: boolean;
  sources: readonly SmartVariantSource[];
  currentSources: readonly SmartVariantSource[];
  plan: SmartVariantPlan | null;
  loading: boolean;
  error: string;
  busy: boolean;
  chatModelsAvailable: boolean;
  onClose: () => void;
  onCancel: () => void;
  onReanalyze: () => void;
  onApply: () => void;
  onPlanChange: Dispatch<SetStateAction<SmartVariantPlan | null>>;
};

export default function CanvasSmartVariantDialog({ open, sources, currentSources, plan, loading, error, busy, chatModelsAvailable, onClose, onCancel, onReanalyze, onApply, onPlanChange }: CanvasSmartVariantDialogProps) {
  if (!open) return null;
  return createPortal(
                  <div className="smart-variant-backdrop" role="dialog" aria-modal="true" aria-label="智能一键变体"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onClose(); }}
          >
            <div className="smart-variant-dialog">
              <header>
                <div><strong>智能一键变体</strong><small>原文段落已锁定，AI 仅能一对一整理，不新增或删除信息</small></div>
                <button type="button" onClick={onClose} aria-label="关闭">×</button>
              </header>
              {loading ? <div className="smart-variant-loading">正在分析共同提示词和直接连接的 Agent 文案…<button type="button" onClick={onCancel}>停止分析</button></div> : error ? <div className="smart-variant-error">{error}</div> : plan && (
                <div className="smart-variant-grid">
                  <section>
                    <b>分析来源</b>
                    {JSON.stringify(sources) !== JSON.stringify(currentSources) && <p role="status">原文已更新；当前显示上次分析来源。</p>}
                    {sources.map((source) => <details key={source.id} open><summary>{source.name}</summary><p>{source.text}</p></details>)}
                    <b>识别分类</b>
                    <div className="smart-variant-tags">{plan.categories.map((category) => <span key={category}>{category}</span>)}</div>
                  </section>
                  <section>
                    <div className="smart-variant-result-head"><b>变体草稿</b><small>原文 {smartVariantSourceUnits((sources || []).filter((source) => source.id !== "shared-prompt")).length} 段 → {plan.variants.length} 条，可编辑</small></div>
                    <div className="smart-variant-drafts">
                      {plan.variants.map((variant, index) => <article key={index}>
                        <div><span>{index + 1}</span><input value={variant.category || ""} placeholder="分类" onChange={(event) => onPlanChange((current) => current && ({ ...current, variants: current.variants.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item) }))} /></div>
                        <textarea value={variant.instruction} onChange={(event) => onPlanChange((current) => current && ({ ...current, variants: current.variants.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item) }))} />
                        {variant.sources?.length ? <details><summary>查看来源片段</summary><p>{variant.sources.join("\n")}</p></details> : null}
                      </article>)}
                    </div>
                  </section>
                </div>
              )}
              <footer>
                {busy && <span role="status">生成中，仅可查看；完成后可应用修改。</span>}
                <button type="button" onClick={() => void onReanalyze()} disabled={loading || !chatModelsAvailable || !currentSources.length}>重新分析</button>
                <button type="button" className="primary-small" onClick={onApply} disabled={!plan?.variants.length || loading || busy}>应用到变体要求</button>
              </footer>
            </div>
          </div>,
    window.document.body,
  );
}

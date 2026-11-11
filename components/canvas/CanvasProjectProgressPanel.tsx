"use client";

import type { CanvasProjectProgress, CanvasProjectProgressAction } from "@/lib/canvas/project-progress";
import type { CanvasProjectQuality } from "@/lib/canvas/project-quality";
import type { CanvasWorkspaceRecommendation } from "@/lib/canvas/workspace-recommendation";
import { CREATIVE_PROJECT_DELIVERABLE_OPTIONS } from "@/packages/contracts/creative";

export default function CanvasProjectProgressPanel({
  projectName,
  progress,
  quality,
  recommendation,
  canExport,
  onRecommendation,
  onAction,
  onOpenNode,
  onExportPackage,
  onScaffold,
}: {
  projectName: string;
  progress: CanvasProjectProgress;
  quality: CanvasProjectQuality;
  recommendation: CanvasWorkspaceRecommendation;
  canExport: boolean;
  onRecommendation: () => void;
  onAction: (action: CanvasProjectProgressAction) => void;
  onOpenNode: (nodeId: string) => void;
  onExportPackage: () => void;
  onScaffold?: () => void;
}) {
  const metrics = [
    { label: "节点", value: progress.counts.nodes },
    { label: "素材", value: progress.counts.assets },
    { label: "进行中", value: progress.counts.running, tone: "pending" },
    { label: "失败记录", value: progress.counts.failed, tone: "error" },
  ];
  const deliverable = CREATIVE_PROJECT_DELIVERABLE_OPTIONS.find((option) => option.value === progress.deliverable);

  return (
    <section className="canvas-project-progress" aria-label="项目进度">
      <div className="canvas-project-progress-heading">
        <span>当前项目</span>
        <h2>{projectName || "未命名项目"}</h2>
        <p>{deliverable?.label || "自动判断"} · 脚本、生成结果和项目版本都从这里继续。</p>
      </div>

      <div className="canvas-project-progress-metrics" aria-label="项目概览">
        {metrics.map((metric) => (
          <div className={metric.tone ? `tone-${metric.tone}` : ""} key={metric.label}>
            <b>{metric.value}</b>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      <section className="canvas-project-progress-next" aria-labelledby="canvas-project-progress-next-title">
        <div className="canvas-project-progress-eyebrow">推荐下一步</div>
        <button type="button" onClick={onRecommendation}>
          <span className="canvas-project-progress-next-mark" aria-hidden="true">→</span>
          <span className="canvas-project-progress-next-copy">
            <b id="canvas-project-progress-next-title">{recommendation.title}</b>
            <small>{recommendation.detail}</small>
          </span>
          <span className="canvas-project-progress-next-arrow" aria-hidden="true">›</span>
        </button>
      </section>
      {progress.scaffold && onScaffold ? (
        <button type="button" className="canvas-project-scaffold" onClick={onScaffold}>
          <span className="canvas-project-scaffold-mark" aria-hidden="true">✦</span>
          <span><b>{progress.scaffold.label}</b><small>{progress.scaffold.detail}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}

      <section className={`canvas-project-quality ${quality.status}`} aria-labelledby="canvas-project-quality-title">
        <div className="canvas-project-quality-heading">
          <div>
            <span className="canvas-project-progress-eyebrow">交付前检查</span>
            <b id="canvas-project-quality-title">项目健康度 {quality.score} / 100</b>
            <small className="canvas-project-quality-scoring">阻塞 −{quality.scoreDeductions.error} · 优化 −{quality.scoreDeductions.warning} · 提示 −{quality.scoreDeductions.info}</small>
          </div>
          <span className="canvas-project-quality-state">{quality.status === "ready" ? "可以继续交付" : quality.status === "blocked" ? "先处理阻塞项" : "还有优化项"}</span>
        </div>
        {quality.checks.length ? (
          <ul className="canvas-project-quality-list">
            {quality.checks.slice(0, 4).map((check) => (
              <li className={check.severity} key={check.id}>
                {check.action ? (
                  <button type="button" onClick={() => onAction(check.action!)}>
                    <span className="canvas-project-quality-mark" aria-hidden="true">{check.severity === "error" ? "!" : check.severity === "warning" ? "·" : "i"}</span>
                    <span><b>{check.label}</b><small>{check.detail}</small></span><span aria-hidden="true">›</span>
                  </button>
                ) : (
                  <div><span className="canvas-project-quality-mark" aria-hidden="true">i</span><span><b>{check.label}</b><small>{check.detail}</small></span></div>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="canvas-project-quality-empty">当前项目没有发现明显问题，可以继续创作或导出。</p>}
      </section>

      <div className="canvas-project-progress-section-heading">
        <b>创作流程</b>
        <span>{progress.counts.versions} 个版本</span>
      </div>
      <ol className="canvas-project-progress-stages">
        {progress.stages.map((stage) => {
          const nodeId = stage.nodeId;
          const content = (
            <>
              <span className="canvas-project-progress-stage-mark" aria-hidden="true">
                {stage.status === "done" ? "✓" : stage.status === "next" ? "→" : "·"}
              </span>
              <span className="canvas-project-progress-stage-copy">
                <b>{stage.label}</b>
                <small>{stage.detail}</small>
              </span>
              <span className={`canvas-project-progress-stage-status ${stage.status}`}>
                {stage.status === "done" ? "已具备" : stage.status === "next" ? "待推进" : "可选"}
              </span>
            </>
          );

          return (
            <li className={stage.status} key={stage.id}>
              {nodeId
                ? <button type="button" onClick={() => onOpenNode(nodeId)}>{content}</button>
                : <div>{content}</div>}
            </li>
          );
        })}
      </ol>

      <div className="canvas-project-progress-export">
        <div>
          <b>带走完整项目</b>
          <small>包含项目设定、画布结构、素材来源索引和版本记录。</small>
        </div>
        <button type="button" disabled={!canExport} onClick={onExportPackage}>导出项目包</button>
      </div>
    </section>
  );
}

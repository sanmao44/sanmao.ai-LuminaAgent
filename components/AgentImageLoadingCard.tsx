"use client";

type AgentImageLoadingActivity = {
  stage?: string;
  model?: string;
  mode?: "edit" | "generate";
  count?: number;
  message?: string;
};

export default function AgentImageLoadingCard({ activity }: { activity?: AgentImageLoadingActivity }) {
  const stage = activity?.stage || "image_planning";
  const imageGenerating = stage === "image" || stage === "image_generating";
  const message = stage === "caption" ? "图片已生成，正在整理创作建议…" : imageGenerating ? "正在生成图片…" : "正在构思画面…";
  const details = [activity?.model, activity?.mode === "edit" ? "编辑模式" : activity?.mode === "generate" ? "生成模式" : "", activity?.count ? `${activity.count} 张` : ""].filter(Boolean).join(" · ");
  const note = details || (activity?.message && activity.message !== message ? activity.message : stage === "caption" ? "马上展示图片与创作建议" : "正在处理本次创作请求");
  return <div className="agent-image-loading-card" role="status" aria-live="polite">
    <div className="agent-image-loading-scan" />
    <div className="agent-image-loading-copy"><strong>{message}</strong><small>{note}</small></div>
    <div className="agent-image-loading-skeleton" aria-hidden="true"><i /><i /><i /></div>
  </div>;
}

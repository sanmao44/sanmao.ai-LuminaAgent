import type { CreativeProjectBrief, CreativeProjectDeliverable } from "@/packages/contracts/creative";
import { canvasTaskBelongsToProject } from "@/lib/canvas/activity-log";
import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";
import type { GenerationLog } from "@/lib/generation-log";
import type { CanvasProjectProgressAction } from "./project-progress";

export type CanvasProjectQualitySeverity = "error" | "warning" | "info";

export type CanvasProjectQualityCheck = {
  id: "brief" | "failed-task" | "pending-task" | "orphan-asset" | "empty-generator" | "missing-audio" | "version";
  severity: CanvasProjectQualitySeverity;
  label: string;
  detail: string;
  action?: CanvasProjectProgressAction;
};

export type CanvasProjectQuality = {
  status: "ready" | "attention" | "blocked";
  score: number;
  scoreDeductions: Readonly<Record<CanvasProjectQualitySeverity, number>>;
  checks: CanvasProjectQualityCheck[];
};

const SCORE_DEDUCTIONS: Record<CanvasProjectQualitySeverity, number> = {
  error: 35,
  warning: 15,
  info: 4,
};

function readyAsset(node: CanvasNode) {
  return (node.type === "media" || node.type === "upscale")
    && Boolean(String(node.data.url || "").trim())
    && node.data.status !== "running"
    && node.data.status !== "queued";
}

function briefConfigured(brief?: CreativeProjectBrief | null) {
  return Boolean(brief && ([brief.intent, brief.style, brief.audience, brief.constraints].some((item) => item?.trim())
    || (brief.deliverable && brief.deliverable !== "auto")));
}

function deliverableOf(brief?: CreativeProjectBrief | null): CreativeProjectDeliverable {
  return brief?.deliverable || "auto";
}

function latest(nodes: readonly CanvasNode[]) {
  return nodes.at(-1);
}

export function deriveCanvasProjectQuality(input: {
  document: CanvasDocument;
  brief?: CreativeProjectBrief | null;
  versionCount: number;
  taskLogs: readonly GenerationLog[];
  projectId?: string;
  canvasId?: string;
}): CanvasProjectQuality {
  const nodes = input.document.nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const taskIds = new Set(nodes.flatMap((node) => [
    String(node.data.jobId || "").trim(),
    String(node.data.generation?.taskId || "").trim(),
  ].filter(Boolean)));
  const tasks = input.taskLogs.filter((log) => canvasTaskBelongsToProject(log, {
    projectId: input.projectId,
    canvasId: input.canvasId,
    nodeIds,
    taskIds,
  }));
  const checks: CanvasProjectQualityCheck[] = [];
  const brief = input.brief;
  const deliverable = deliverableOf(brief);
  if (!briefConfigured(brief)) {
    checks.push({
      id: "brief",
      severity: "warning",
      label: "项目设定还不完整",
      detail: "补充目标、风格、受众或约束后，后续生成会更稳定。",
      action: { kind: "edit-brief", label: "补充项目创作设定", detail: "保存项目级上下文" },
    });
  }

  const failedTask = tasks.slice().reverse().find((task) => task.status === "error");
  if (failedTask) {
    checks.push({
      id: "failed-task",
      severity: "error",
      label: "有失败任务需要处理",
      detail: failedTask.error || "恢复任务上下文后可以重试或继续生成。",
      action: { kind: "review-task", taskId: failedTask.id, taskStatus: "error", label: "检查失败任务", detail: "恢复原始输入并重试" },
    });
  }
  if (tasks.some((task) => task.status === "pending")) {
    checks.push({
      id: "pending-task",
      severity: "info",
      label: "仍有生成任务进行中",
      detail: "等待任务完成后再导出，避免遗漏最新结果。",
    });
  }

  const readyAssets = nodes.filter(readyAsset);
  const orphanAssets = readyAssets.filter((node) => !input.document.edges.some((edge) => edge.source === node.id || edge.target === node.id));
  if (orphanAssets.length) {
    const target = latest(orphanAssets);
    checks.push({
      id: "orphan-asset",
      severity: "warning",
      label: `${orphanAssets.length} 个素材尚未接入流程`,
      detail: "确认它们是最终资产，或把它们连接到生成、剪辑或导出节点。",
      ...(target ? { action: { kind: "open-node", nodeId: target.id, label: "查看孤立素材", detail: "定位最近的未连接素材" } } : {}),
    });
  }

  const emptyGenerator = nodes.find((node) => node.type === "generator" && !String(node.data.prompt || node.data.text || "").trim());
  if (emptyGenerator) {
    checks.push({
      id: "empty-generator",
      severity: "warning",
      label: "有生成节点还没有提示词",
      detail: "补充提示词或连接文字草案，再开始生成。",
      action: { kind: "open-node", nodeId: emptyGenerator.id, label: "补充生成提示词", detail: "定位空提示词节点" },
    });
  }

  const videos = readyAssets.filter((node) => node.data.kind === "video");
  const audios = readyAssets.filter((node) => node.data.kind === "audio");
  if ((deliverable === "video" || deliverable === "auto") && videos.length > 0 && audios.length === 0) {
    checks.push({
      id: "missing-audio",
      severity: "warning",
      label: "视频还没有配音或音频",
      detail: "补一条配音、对白或环境音，成片交付会更完整。",
      action: { kind: "create-node", nodeKind: "audio", label: "补充视频音频", detail: "创建音频节点并连接到项目" },
    });
  }

  if (nodes.length > 0 && input.versionCount === 0) {
    checks.push({
      id: "version",
      severity: "warning",
      label: "还没有可恢复版本",
      detail: "保存一个检查点，后续试错和回溯会更安心。",
      action: { kind: "save-version", label: "保存项目检查点", detail: "记录当前画布与设定" },
    });
  }

  const hasError = checks.some((check) => check.severity === "error");
  const score = Math.max(0, 100 - checks.reduce((total, check) => total + SCORE_DEDUCTIONS[check.severity], 0));
  return {
    status: hasError ? "blocked" : checks.some((check) => check.severity === "warning") ? "attention" : "ready",
    score,
    scoreDeductions: { ...SCORE_DEDUCTIONS },
    checks,
  };
}

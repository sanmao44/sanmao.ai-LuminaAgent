import type { CreativeProjectDeliverable } from "@/packages/contracts/creative";
import type { CanvasNodeCreationKind } from "@/lib/canvas/types";

export type CanvasProjectWorkflowStep = {
  kind: CanvasNodeCreationKind;
  label: string;
};

export function projectWorkflowScaffold(deliverable: CreativeProjectDeliverable): CanvasProjectWorkflowStep[] {
  if (deliverable === "copy") return [{ kind: "text", label: "内容草案" }];
  if (deliverable === "image") return [
    { kind: "text", label: "内容草案" },
    { kind: "workflowImage", label: "图片生成" },
  ];
  if (deliverable === "audio") return [
    { kind: "text", label: "旁白草案" },
    { kind: "audio", label: "配音生成" },
  ];
  if (deliverable === "video") return [
    { kind: "text", label: "脚本与分镜" },
    { kind: "workflowImage", label: "分镜视觉" },
    { kind: "workflowVideo", label: "视频生成" },
    { kind: "audio", label: "配音生成" },
    { kind: "videoEditor", label: "剪辑预览" },
  ];
  return [
    { kind: "text", label: "内容草案" },
    { kind: "workflowImage", label: "图片生成" },
    { kind: "workflowVideo", label: "视频生成" },
    { kind: "audio", label: "配音生成" },
    { kind: "videoEditor", label: "剪辑预览" },
  ];
}

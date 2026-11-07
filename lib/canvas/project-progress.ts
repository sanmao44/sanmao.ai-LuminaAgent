import type { CreativeProjectBrief, CreativeProjectDeliverable } from "@/packages/contracts/creative";
import { canvasTaskBelongsToProject } from "@/lib/canvas/activity-log";
import type { CanvasDocument, CanvasNode, CanvasNodeCreationKind } from "@/lib/canvas/types";
import type { GenerationLog } from "@/lib/generation-log";
import { projectWorkflowScaffold } from "@/lib/canvas/project-workflow";

export type CanvasProjectProgressAction =
  | { kind: "review-task"; taskId: string; taskStatus: "pending" | "error"; label: string; detail: string }
  | { kind: "edit-brief"; label: string; detail: string }
  | { kind: "draft-content"; label: string; detail: string }
  | { kind: "create-node"; nodeKind: CanvasNodeCreationKind; sourceNodeIds?: string[]; label: string; detail: string }
  | { kind: "save-version"; label: string; detail: string }
  | { kind: "open-node"; nodeId: string; label: string; detail: string };

export type CanvasProjectProgressStage = {
  id: "brief" | "content" | "visual" | "audio" | "edit" | "history";
  label: string;
  detail: string;
  status: "done" | "next" | "optional";
  nodeId?: string;
};

export type CanvasProjectProgress = {
  deliverable: CreativeProjectDeliverable;
  counts: {
    nodes: number;
    assets: number;
    images: number;
    videos: number;
    audio: number;
    tasks: number;
    running: number;
    failed: number;
    versions: number;
  };
  stages: CanvasProjectProgressStage[];
  nextAction: CanvasProjectProgressAction;
  scaffold?: { label: string; detail: string };
};

export function seedCanvasProjectIntent(document: CanvasDocument, nodeId: string, intent: string) {
  const text = intent.trim();
  if (!text) return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== "prompt" || String(node.data.text || "").trim()) return node;
    changed = true;
    return { ...node, data: { ...node.data, text } };
  });
  return changed ? { ...document, nodes } : document;
}

export function canvasProjectDraftPrompt(brief: CreativeProjectBrief | null | undefined) {
  const deliverable = brief?.deliverable || "auto";
  const direction = deliverable === "video"
    ? "起草一份可执行的短视频脚本和 6-8 个分镜，逐镜写清画面、动作、景别/运镜、对白或旁白及声音提示。"
    : deliverable === "copy"
      ? "起草一份可直接审阅的文案，提供主版本、3 个标题备选和可按渠道调整的短版本。"
      : deliverable === "freeform"
        ? "先判断最适合这个目标的内容形式，再给出结构清楚、可直接继续编辑的第一版草案。"
        : "先判断最适合这个目标的内容形式，再起草能推动项目进入下一步的第一版文字内容；若适合视频，附上分镜。";
  return [
    "请根据当前画布已提供的项目创作设定，为本项目起草内容。",
    direction,
    "先只产出文字草案，不调用图像、视频或音频生成。完成后把草案作为新的可编辑文本节点加入当前画布，不要覆盖或改写已有节点。",
    "遵守项目意图、风格、受众与约束；设定不足时明确列出待确认项，不要编造产品事实。",
  ].join("\n\n");
}

function nodeCreatedAt(node: CanvasNode) {
  return Number(node.data.speechGeneration?.createdAt || node.data.generation?.createdAt || 0);
}

function isReadyAsset(node: CanvasNode) {
  return (node.type === "media" || node.type === "upscale")
    && Boolean(String(node.data.url || "").trim())
    && node.data.status !== "running"
    && node.data.status !== "queued";
}

function briefIsConfigured(value: CreativeProjectBrief | null | undefined) {
  return Boolean(value && ([value.intent, value.style, value.audience, value.constraints].some((item) => item?.trim())
    || (value.deliverable && value.deliverable !== "auto")));
}

function projectDeliverable(value: CreativeProjectBrief | null | undefined): CreativeProjectDeliverable {
  return value?.deliverable || "auto";
}

function mostRecent(nodes: readonly CanvasNode[]) {
  return nodes.slice().sort((left, right) => nodeCreatedAt(right) - nodeCreatedAt(left))[0];
}

function existingCreationNode(nodes: readonly CanvasNode[], kind: CanvasNodeCreationKind) {
  return mostRecent(nodes.filter((node) => {
    if (kind === "text") return node.type === "prompt";
    if (kind === "videoEditor") return node.type === "video-editor";
    const mediaKind = kind === "workflowImage" ? "image" : kind === "workflowVideo" ? "video" : kind === "audio" ? "audio" : null;
    if (!mediaKind) return false;
    return node.data.kind === mediaKind
      && (node.type === "generator" || (node.type === "media" && !String(node.data.url || "").trim()));
  }));
}

function mostRecentTask(logs: readonly GenerationLog[]) {
  return logs.slice().sort((left, right) => {
    const leftCreatedAt = Date.parse(left.createdAt);
    const rightCreatedAt = Date.parse(right.createdAt);
    return (Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0)
      - (Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0);
  })[0];
}

export function deriveCanvasProjectProgress(input: {
  document: CanvasDocument;
  brief?: CreativeProjectBrief | null;
  versionCount: number;
  taskLogs: readonly GenerationLog[];
  projectId?: string;
  canvasId?: string;
}) : CanvasProjectProgress {
  const { document } = input;
  const scopedTasks = input.taskLogs.filter((log) => canvasTaskBelongsToProject(log, {
    projectId: input.projectId,
    canvasId: input.canvasId,
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    taskIds: new Set(document.nodes.flatMap((node) => [
      String(node.data.jobId || "").trim(),
      String(node.data.generation?.taskId || "").trim(),
    ].filter(Boolean))),
  }));
  const mediaTasks = scopedTasks.filter((log) => log.mode !== "llm" && log.taskKind !== "llm");
  const activeTask = mostRecentTask(mediaTasks.filter((log) => log.status === "pending"));
  const latestTask = mostRecentTask(mediaTasks);
  const prompts = document.nodes.filter((node) => node.type === "prompt" && Boolean(
    String(node.data.text || node.data.agentResponse || node.data.agentPrompt || "").trim(),
  ));
  const readyAssets = document.nodes.filter(isReadyAsset);
  const images = readyAssets.filter((node) => node.data.kind !== "video" && node.data.kind !== "audio");
  const videos = readyAssets.filter((node) => node.data.kind === "video");
  const audio = readyAssets.filter((node) => node.data.kind === "audio");
  const videoEditors = document.nodes.filter((node) => node.type === "video-editor");
  const editedVideos = videoEditors.filter((node) => Boolean(node.data.videoEditor?.clips.some((clip) => clip.enabled !== false)));
  const latestVisual = mostRecent([...images, ...videos]);
  const latestImage = mostRecent(images);
  const latestVideo = mostRecent(videos);
  const latestAudio = mostRecent(audio);
  const latestEditor = mostRecent(videoEditors);
  const latestEditedVideo = mostRecent(editedVideos);
  const latestPrompt = mostRecent(prompts);
  const latestProgressVisualId = latestVisual?.id || latestEditedVideo?.id;
  const editorSourceNodeIds = [latestVideo || latestVisual, latestAudio]
    .filter((node): node is CanvasNode => Boolean(node))
    .map((node) => node.id);
  const hasBrief = briefIsConfigured(input.brief);
  const hasContent = prompts.length > 0;
  const hasVisual = images.length + videos.length + editedVideos.length > 0;
  const deliverable = projectDeliverable(input.brief);
  const contentRequired = deliverable === "auto" || deliverable === "video" || deliverable === "copy" || deliverable === "freeform";
  const visualComplete = deliverable === "image" ? images.length > 0 : hasVisual;
  const visualRequired = deliverable === "auto" || deliverable === "video" || deliverable === "image";
  const audioRequired = deliverable === "video" || deliverable === "audio";
  const editRequired = deliverable === "auto" || deliverable === "video";

  let nextAction: CanvasProjectProgressAction;
  if (activeTask) {
    nextAction = {
      kind: "review-task",
      taskId: activeTask.id,
      taskStatus: "pending",
      label: "查看进行中的生成",
      detail: "任务仍在后台运行；查看状态，避免重复提交相同内容。",
    };
  } else if (latestTask?.status === "error") {
    nextAction = {
      kind: "review-task",
      taskId: latestTask.id,
      taskStatus: "error",
      label: "检查失败任务",
      detail: `${latestTask.error || "最近任务需要检查"}；恢复上下文后可沿用原始输入继续。`,
    };
  } else if (!hasBrief) {
    nextAction = { kind: "edit-brief", label: "补充项目创作设定", detail: "把风格、受众或必须遵守的约束保存为项目共享上下文。" };
  } else if (!hasContent && contentRequired && (deliverable !== "freeform" || document.nodes.length === 0)) {
    nextAction = {
      kind: "draft-content",
      label: deliverable === "video" ? "让 AI 起草脚本与分镜" : "让 AI 起草第一版内容",
      detail: "已带入项目设定；检查起稿指令后发送，生成文字草案并加入画布。",
    };
  } else if (visualRequired && !visualComplete) {
    nextAction = {
      kind: "create-node",
      nodeKind: "workflowImage",
      ...(latestPrompt ? { sourceNodeIds: [latestPrompt.id] } : {}),
      label: "生成第一份视觉素材",
      detail: latestPrompt
        ? "已选中最近的脚本草案作为输入，创建图像节点后即可生成。"
        : "从项目草案进入图像生成，结果会留在当前项目画布。",
    };
  } else if ((deliverable === "auto" || deliverable === "video") && !videos.length && images.length > 0) {
    nextAction = {
      kind: "create-node",
      nodeKind: "workflowVideo",
      ...(latestImage ? { sourceNodeIds: [latestImage.id] } : {}),
      label: "把视觉素材推进到视频",
      detail: latestImage
        ? "创建视频生成节点，并自动连接最近完成的图片作为参考。"
        : "创建视频生成节点，再连接项目中的图片作为参考。",
    };
  } else if ((deliverable === "auto" || deliverable === "video" || deliverable === "audio") && audio.length === 0 && (deliverable === "audio" || videos.length > 0)) {
    nextAction = {
      kind: "create-node",
      nodeKind: "audio",
      label: deliverable === "audio" ? "生成第一条音频" : "为视频补充配音",
      detail: deliverable === "audio"
        ? "在音频节点写入旁白或对白，调用已配置的在线或本机语音引擎。"
        : "在音频节点写入旁白，调用已配置的在线或本机语音引擎。",
    };
  } else if ((deliverable === "auto" || deliverable === "video") && (videos.length > 0 || readyAssets.length > 1) && editedVideos.length === 0) {
    nextAction = {
      kind: "create-node",
      nodeKind: "videoEditor",
      ...(editorSourceNodeIds.length ? { sourceNodeIds: editorSourceNodeIds } : {}),
      label: "整理素材并预览成片",
      detail: editorSourceNodeIds.length
        ? "已把最近的视频、配音或视觉素材接入时间线，可继续调整镜头顺序和字幕。"
        : "创建剪辑节点后可加入画布素材，继续编辑字幕和时间线。",
    };
  } else if (input.versionCount === 0) {
    nextAction = { kind: "save-version", label: "保存项目检查点", detail: "为当前画布和创作设定留一个可恢复版本。" };
  } else {
    const latestOutput = mostRecent([...editedVideos, ...videos, ...images, ...audio, ...prompts]);
    nextAction = latestOutput
      ? { kind: "open-node", nodeId: latestOutput.id, label: "检查最近的创作结果", detail: "预览结果后可继续调整，或导出项目包交接与备份。" }
      : { kind: "save-version", label: "保存项目检查点", detail: "为当前画布和创作设定留一个可恢复版本。" };
  }

  if (nextAction.kind === "create-node") {
    const existingNode = existingCreationNode(document.nodes, nextAction.nodeKind);
    if (existingNode) {
      nextAction = {
        kind: "open-node",
        nodeId: existingNode.id,
        label: "继续已有创作节点",
        detail: "定位已创建的节点，沿用现有输入继续编辑或生成。",
      };
    }
  } else if (nextAction.kind === "draft-content") {
    const existingNode = existingCreationNode(document.nodes, "text");
    if (existingNode) {
      nextAction = {
        kind: "open-node",
        nodeId: existingNode.id,
        label: "继续已有创作节点",
        detail: "定位现有草案节点；让 AI 起稿前先确认这里没有尚未保存的内容。",
      };
    }
  }

  const stages: CanvasProjectProgressStage[] = [
    {
      id: "brief",
      label: "项目设定",
      detail: hasBrief ? "创作约束或交付目标已保存" : "未保存项目级创作约束",
      status: hasBrief ? "done" : "next",
    },
    {
      id: "content",
      label: "脚本与提示词",
      detail: hasContent ? `${prompts.length} 个内容草案节点` : "还没有可复用的内容草案",
      status: hasContent ? "done" : contentRequired ? "next" : "optional",
      ...(latestPrompt ? { nodeId: latestPrompt.id } : {}),
    },
    {
      id: "visual",
      label: "视觉素材",
      detail: `${images.length} 张图片 · ${videos.length} 段视频${editedVideos.length ? ` · ${editedVideos.length} 条剪辑时间线` : ""}`,
      status: visualComplete ? "done" : visualRequired ? "next" : "optional",
      ...(latestProgressVisualId ? { nodeId: latestProgressVisualId } : {}),
    },
    {
      id: "audio",
      label: "配音与音频",
      detail: audio.length ? `${audio.length} 条音频素材` : "可选：配音、对白或环境音",
      status: audio.length ? "done" : audioRequired && (deliverable === "audio" || videos.length > 0) ? "next" : "optional",
      ...(latestAudio ? { nodeId: latestAudio.id } : {}),
    },
    {
      id: "edit",
      label: "剪辑与预览",
      detail: editedVideos.length ? `${editedVideos.length} 个含素材的剪辑时间线` : videos.length ? "有视频素材，可加入剪辑时间线" : "视频项目可在此组织镜头与字幕",
      status: editedVideos.length ? "done" : editRequired && videos.length ? "next" : "optional",
      ...(latestEditor ? { nodeId: latestEditor.id } : {}),
    },
    {
      id: "history",
      label: "版本回溯",
      detail: input.versionCount ? `${input.versionCount} 个可恢复版本` : "还没有项目检查点",
      status: input.versionCount ? "done" : "next",
    },
  ];

  return {
    deliverable,
    counts: {
      nodes: document.nodes.length,
      assets: readyAssets.length,
      images: images.length,
      videos: videos.length,
      audio: audio.length,
      tasks: scopedTasks.length,
      running: scopedTasks.filter((log) => log.status === "pending").length,
      failed: scopedTasks.filter((log) => log.status === "error").length,
      versions: input.versionCount,
    },
    stages,
    nextAction,
    ...(hasBrief && document.nodes.length === 0
      ? { scaffold: { label: `一键搭建${projectWorkflowScaffold(deliverable).length}步流程`, detail: "先把内容、视觉、音频和剪辑节点排好，之后逐步填充即可。" } }
      : {}),
  };
}

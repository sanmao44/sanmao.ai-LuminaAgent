import type { CanvasNodeData, CanvasVariantState } from "./types";
import type { ImageCreationSettings, VideoCreationSettings } from "../creation/settings";
import { canvasVariantBatchStatus } from "./variant-status";
import { videoTaskOutputUrl } from "../video-task-output";

export type CanvasVariantBatchMode = "all" | "failed" | "pending";

/** Projects variant image settings into the existing canvas image API shape. */
export function canvasVariantImageRequest(input: {
  taskId: string;
  prompt: string;
  params: ImageCreationSettings;
  references: readonly { url: string; name?: string }[];
}) {
  const { params } = input;
  return {
    taskId: input.taskId,
    prompt: input.prompt,
    model: params.model,
    count: params.count,
    aspect:
      params.aspect === "鑷畾涔?"
        ? `${params.customAspectWidth}:${params.customAspectHeight}`
        : params.aspect,
    resolution: params.resolution,
    quality: params.quality,
    sizeMode: params.sizeMode,
    ...(params.sizeMode === "custom"
      ? { width: params.width, height: params.height }
      : {}),
    outputFormat: params.outputFormat,
    background:
      params.backgroundMode === "api-transparent"
        ? ("transparent" as const)
        : params.backgroundMode === "opaque"
          ? ("opaque" as const)
          : undefined,
    maskUrl: params.mask?.url,
    moveGuideUrl: params.mask?.sourceUrl,
    references: input.references.map((reference) => ({ ...reference })),
  };
}

/** Projects resolved video inputs into the existing canvas video API shape. */
export function canvasVariantVideoRequest(input: {
  prompt: string;
  params: VideoCreationSettings;
  model: string;
  modelRawId?: string;
  references: readonly { url: string; name?: string }[];
  referenceVideos: readonly { url: string; name?: string }[];
  firstFrame?: string;
  lastFrame?: string;
  referenceVideo?: string;
  audios: readonly { url: string; name?: string }[];
}) {
  const { params } = input;
  return {
    prompt: input.prompt,
    model: input.model,
    modelRawId: input.modelRawId,
    operation: params.operation,
    inputMode: params.inputMode,
    duration: params.duration,
    aspect: params.aspect,
    resolution: params.resolution,
    agnesWidth: params.agnesWidth,
    agnesHeight: params.agnesHeight,
    agnesNumFrames: params.agnesNumFrames,
    agnesFrameRate: params.agnesFrameRate,
    references: input.references.map((item) => ({ ...item })),
    referenceVideos: input.referenceVideos.map((item) => ({ ...item })),
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
    referenceVideo: input.referenceVideo,
    audios: input.audios.map((item) => ({ ...item })),
  };
}

export function canvasVideoTaskProgress(task: {
  status: string;
  progress?: number;
  videoUrls?: readonly string[];
  remoteVideoUrls?: readonly string[];
  error?: string;
}) {
  const url = videoTaskOutputUrl(task);
  const hasVideoResult = Boolean(url);
  const terminal = hasVideoResult || ["done", "failed", "cancelled", "canceled"].includes(task.status);
  const status = hasVideoResult || task.status === "done"
    ? ("completed" as const)
    : terminal
      ? ("failed" as const)
      : ("running" as const);
  return {
    hasVideoResult,
    terminal,
    status,
    progress: Number(task.progress || (status === "completed" ? 100 : 0)),
    url: url || undefined,
  };
}

/** Projects one polled video task into the existing media node data shape. */
export function canvasVariantVideoTaskData(
  data: CanvasNodeData,
  task: {
    status: string;
    progress?: number;
    videoUrls?: readonly string[];
    remoteVideoUrls?: readonly string[];
    error?: string;
  },
  now: number,
): CanvasNodeData {
  const progress = canvasVideoTaskProgress(task);
  const generationDurationMs = progress.terminal && data.generation?.createdAt
    ? Math.max(0, now - data.generation.createdAt)
    : undefined;
  return {
    ...data,
    status: progress.status,
    progress: progress.progress,
    url: progress.url || data.url,
    statusLabel:
      task.error ||
      (progress.status === "completed"
        ? "瑙嗛宸插畬鎴?"
        : progress.terminal
          ? "瑙嗛浠诲姟宸蹭腑鏂?"
          : "瑙嗛鐢熸垚涓?"),
    ...(generationDurationMs !== undefined && data.generation
      ? { generation: { ...data.generation, durationMs: generationDurationMs } }
      : {}),
  };
}

export function canvasVariantVideoNodeData(input: {
  task: {
    id: string;
    status: string;
    progress?: number;
    videoUrls?: readonly string[];
    remoteVideoUrls?: readonly string[];
    error?: string;
    modelId?: string;
  };
  prompt: string;
  params: VideoCreationSettings;
  linkedIds: readonly string[];
  sourceGeneratorId: string;
  variantBatchId: string;
  variantIndex: number;
  variantInstruction: string;
  generationStartedAt: number;
  now: number;
}): CanvasNodeData {
  const progress = canvasVideoTaskProgress(input.task);
  const generationDurationMs = progress.terminal
    ? Math.max(0, input.now - input.generationStartedAt)
    : undefined;
  return {
    role: "变体结果",
    model: input.task.modelId || input.params.model,
    jobId: input.task.id,
    status: progress.status,
    processingStartedAt: progress.status === "running" ? input.now : undefined,
    progress: progress.progress,
    statusLabel: progress.status === "completed" ? "视频已完成" : input.task.error || (progress.status === "failed" ? "视频任务已中断" : "视频生成中"),
    ...(progress.url ? { url: progress.url } : {}),
    generation: {
      kind: "video",
      prompt: input.prompt,
      params: input.params,
      referenceIds: [...input.linkedIds],
      sourceGeneratorId: input.sourceGeneratorId,
      variantBatchId: input.variantBatchId,
      variantIndex: input.variantIndex,
      variantInstruction: input.variantInstruction,
      taskId: input.task.id,
      createdAt: input.generationStartedAt,
      ...(generationDurationMs !== undefined ? { durationMs: generationDurationMs } : {}),
    },
    referenceOrder: [...input.linkedIds],
  };
}

export function canvasVariantImageNodeData(input: {
  prompt: string;
  params: ImageCreationSettings;
  linkedIds: readonly string[];
  sourceGeneratorId: string;
  variantBatchId: string;
  variantIndex: number;
  variantInstruction: string;
  modelName?: string;
  generationStartedAt: number;
  now: number;
}): CanvasNodeData {
  return {
    role: "变体结果",
    model: input.modelName || input.params.model,
    generation: {
      kind: "image",
      prompt: input.prompt,
      params: input.params,
      referenceIds: [...input.linkedIds],
      sourceGeneratorId: input.sourceGeneratorId,
      variantBatchId: input.variantBatchId,
      variantIndex: input.variantIndex,
      variantInstruction: input.variantInstruction,
      createdAt: input.now,
      durationMs: Math.max(0, input.now - input.generationStartedAt),
    },
    referenceOrder: [...input.linkedIds],
  };
}

export function prepareCanvasVariantBatch(
  requirements: readonly string[],
  currentStates: readonly CanvasVariantState[],
  retryIndices: readonly number[] | undefined,
  mode: CanvasVariantBatchMode,
  now = Date.now(),
) {
  const requested = retryIndices
    ? [...new Set(retryIndices)].filter(
        (index) =>
          index >= 0 &&
          index < requirements.length &&
          currentStates[index]?.status === (mode === "pending" ? "pending" : "failed"),
      )
    : requirements.map((_, index) => index);
  const isRetry = mode === "failed";
  const isResume = mode === "pending";
  const initialStates = currentStates.map((state, index) => {
    if (!requested.includes(index)) return state;
    return {
      ...state,
      instruction: requirements[index],
      status: "pending" as const,
      resultIds: isRetry || isResume ? state.resultIds : [],
      taskIds: isRetry || isResume ? state.taskIds : undefined,
      progress: 0,
      error: undefined,
      updatedAt: now,
    };
  });
  return { requested, initialStates, isRetry, isResume };
}

export function applyCanvasVariantStatePatch(
  states: readonly CanvasVariantState[],
  requirements: readonly string[],
  index: number,
  patch: Partial<CanvasVariantState>,
  now = Date.now(),
) {
  const nextStates = states.map((state, stateIndex) =>
    stateIndex === index
      ? {
          ...state,
          ...patch,
          instruction: requirements[stateIndex],
          updatedAt: now,
        }
      : state,
  );
  return {
    states: nextStates,
    status: canvasVariantBatchStatus(nextStates),
  };
}

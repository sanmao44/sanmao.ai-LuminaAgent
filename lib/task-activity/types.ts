export type ActivityTaskKind = "agent" | "image" | "video" | "upscale" | "artifact" | "mcp" | "clone";

export type ActivityTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ActivityTask = {
  id: string;
  kind: ActivityTaskKind;
  status: ActivityTaskStatus;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
  progress?: number;
  stage?: string;
  provider?: string;
  model?: string;
  startedAt?: number;
  finishedAt?: number;
  canRetry: boolean;
  canCancel: boolean;
  outputIds?: string[];
  error?: { code?: string; message: string };
  sourceId?: string;
};

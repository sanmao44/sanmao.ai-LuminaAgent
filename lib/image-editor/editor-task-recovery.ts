export type EditorTaskLogSnapshot = {
  mode?: string;
  status?: string;
  imageUrls?: readonly unknown[];
  error?: string;
  errorCode?: string;
  providerTaskId?: string;
  storageError?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  aspectRatio?: string;
  outputSize?: string;
  durationMs?: number;
  references?: readonly { id?: unknown; name?: unknown; url?: unknown; dataUrl?: unknown }[];
};

export type EditorTaskRecoveryResult =
  | { kind: "completed"; log: EditorTaskLogSnapshot; images: { url: string }[] }
  | { kind: "failed"; log: EditorTaskLogSnapshot; error: string; errorCode?: string; providerTaskId?: string; providerPossiblyAccepted: boolean; providerResultWithheld: boolean }
  | { kind: "not-found" }
  | { kind: "pending"; message: string };

type RecoveryOptions = {
  maxAttempts?: number;
  maxMissingAttempts?: number;
  pollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForEditorTaskLog(
  taskId: string,
  loadLog: (taskId: string, signal?: AbortSignal) => Promise<EditorTaskLogSnapshot | null>,
  options: RecoveryOptions = {},
): Promise<EditorTaskRecoveryResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 600);
  const maxMissingAttempts = Math.max(1, options.maxMissingAttempts ?? 3);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 3000);
  const pause = options.wait || wait;
  let missingAttempts = 0;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) return { kind: "pending", message: "任务状态核对已暂停。" };
    let log: EditorTaskLogSnapshot | null = null;
    try {
      log = await loadLog(taskId, options.signal);
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "无法读取服务端任务状态";
    }

    if (log && log.mode && log.mode !== "edit") {
      return { kind: "failed", log, error: "任务记录类型不匹配，未自动重试。", providerPossiblyAccepted: false, providerResultWithheld: false };
    }

    if (log?.status === "success") {
      const images = (log.imageUrls || [])
        .filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
        .map((url) => ({ url }));
      if (!images.length) {
        return {
          kind: "failed",
          log,
          error: "服务端没有保存可用图片结果，服务商是否完成本轮任务仍未确认。",
          errorCode: "provider_result_unconfirmed",
          providerPossiblyAccepted: true,
          providerResultWithheld: false,
        };
      }
      return { kind: "completed", log, images };
    }

    if (log?.status === "error") {
      const providerResultWithheld = log.errorCode === "edit_result_withheld";
      const providerPossiblyAccepted = providerResultWithheld || log.errorCode === "provider_result_unconfirmed" || Boolean(log.providerTaskId);
      return {
        kind: "failed",
        log,
        error: log.error || (providerPossiblyAccepted ? "服务商可能已接收任务，但结果尚未确认。" : "图片编辑任务失败。"),
        errorCode: log.errorCode,
        providerTaskId: log.providerTaskId,
        providerPossiblyAccepted,
        providerResultWithheld,
      };
    }

    if (!log) {
      missingAttempts += 1;
      if (missingAttempts >= maxMissingAttempts && !lastError) return { kind: "not-found" };
    } else {
      missingAttempts = 0;
    }

    if (attempt + 1 < maxAttempts) await pause(pollIntervalMs);
  }

  return {
    kind: "pending",
    message: lastError || "服务商仍未返回完成状态；为避免重复提交，任务暂记为待核对。",
  };
}

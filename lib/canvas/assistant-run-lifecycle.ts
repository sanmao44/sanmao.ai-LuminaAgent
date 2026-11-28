import type { AgentAssistantRunStatus } from "@/packages/contracts/agent";

export type CanvasAssistantRunIdentity = {
  runId: string;
  scopeKey: string;
  pendingId: string;
  controller: AbortController;
  remoteRequestStarted: boolean;
  localExecutionSettled: boolean;
  cancelRequested: boolean;
  cancelRequestInFlight: boolean;
  cancelRequest?: Promise<CanvasAssistantCancelResult>;
};

export type CanvasAssistantRunReference = Pick<CanvasAssistantRunIdentity, "runId" | "scopeKey" | "pendingId">;

export function isCurrentCanvasAssistantRun(
  active: CanvasAssistantRunReference | null,
  expected: CanvasAssistantRunReference,
) {
  return Boolean(active
    && active.runId === expected.runId
    && active.scopeKey === expected.scopeKey
    && active.pendingId === expected.pendingId);
}

export function finalizeCanvasAssistantRunMessage<T extends { content: string }>(message: T, partial = "") {
  return {
    ...message,
    pending: undefined,
    activity: undefined,
    assistantRun: undefined,
    content: partial.trim() || message.content.trim() || "已停止这一轮回答。",
    interrupted: true,
  };
}

export type CanvasAssistantCancelResult =
  | { kind: "local" }
  | { kind: "already-requested" }
  | { kind: "awaiting-run" }
  | { kind: "requested"; status: AgentAssistantRunStatus };

export async function requestCanvasAssistantRunCancellation(
  run: CanvasAssistantRunIdentity,
  cancel: (runId: string) => Promise<AgentAssistantRunStatus>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryLimit = 120,
): Promise<CanvasAssistantCancelResult> {
  run.cancelRequested = true;
  if (!run.remoteRequestStarted) {
    run.controller.abort(new DOMException("已停止", "AbortError"));
    return { kind: "local" };
  }
  if (run.cancelRequest) return run.cancelRequest;

  run.cancelRequestInFlight = true;
  run.cancelRequest = (async () => {
    for (let attempt = 0; attempt < retryLimit; attempt += 1) {
      try {
        return { kind: "requested", status: await cancel(run.runId) } as const;
      } catch (error) {
        if ((error as { status?: number } | null)?.status !== 404) throw error;
        if (run.localExecutionSettled) return { kind: "awaiting-run" } as const;
        await wait(250);
      }
    }
    return { kind: "awaiting-run" } as const;
  })();
  try {
    return await run.cancelRequest;
  } finally {
    run.cancelRequestInFlight = false;
    run.cancelRequest = undefined;
  }
}

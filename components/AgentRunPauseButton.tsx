import type { AgentAssistantRunAction, AgentAssistantRunStatus } from "@/packages/contracts/agent";
import { assistantRunStatusLabel } from "@/lib/agent-client";
import styles from "./AgentRunPauseButton.module.css";

export default function AgentRunPauseButton({ status, busy, onAction }: {
  status: AgentAssistantRunStatus;
  busy?: boolean;
  onAction: (action: AgentAssistantRunAction) => void;
}) {
  if (status.state === "pausing" || status.state === "cancelling") return null;
  if (status.state !== "running" && status.state !== "paused") return null;
  const paused = status.state === "paused";
  return (
    <button
      type="button"
      className={styles.button}
      disabled={busy}
      title={paused ? assistantRunStatusLabel(status) : "当前步骤结束后暂停"}
      onClick={() => onAction(paused ? "resume" : "pause")}
    >
      {paused ? "继续任务" : "暂停任务"}
    </button>
  );
}

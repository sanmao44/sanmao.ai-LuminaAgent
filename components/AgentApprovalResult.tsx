"use client";

import { useState } from "react";
import { resumeAgentRun, type AgentFilesystemUndo } from "@/lib/agent-client";
import type { AgentApprovalOutcome } from "@/components/AgentApprovalCard";

type Props = {
  message: string;
  filesystemUndos?: AgentFilesystemUndo[];
  onResolved?: (outcome: AgentApprovalOutcome) => void;
};

export default function AgentApprovalResult({ message, filesystemUndos = [], onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const undos = filesystemUndos.filter((undo) => undo.expiresAt > Date.now());

  async function undoEdit(id: string) {
    if (busy || !onResolved) return;
    setBusy(true);
    setError("");
    try {
      const result = await resumeAgentRun(id, "undo");
      onResolved({
        message: `${message}\n${result.message || "已撤销本次修改。"}`,
        filesystemUndos: undos.filter((undo) => undo.id !== id),
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "撤销失败，请核对文件内容。";
      if (reason instanceof Error && "consumed" in reason && reason.consumed === true) {
        onResolved({
          message: `${message}\n这条撤销记录已结束，按钮已移除；请核对当前文件后再手动处理。`,
          filesystemUndos: undos.filter((undo) => undo.id !== id),
        });
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="message-approval-result">
      <span>{message}</span>
      {onResolved && undos.length > 0 ? (
        <div className="agent-approval-actions">
          {undos.map((undo) => (
            <button key={undo.id} type="button" title={undo.path} disabled={busy} onClick={() => void undoEdit(undo.id)}>
              {undos.length === 1 ? "撤销本次修改" : `撤销 ${undo.path.split(/[\\/]/).at(-1)}`}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="agent-approval-error" role="alert">{error}</p> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { resumeAgentRun, type AgentApproval, type AgentMcpToolUse } from "@/lib/agent-client";

export type AgentApprovalOutcome = {
  message: string;
  rejected?: boolean;
  mcpTools?: AgentMcpToolUse[];
};

const RISK_LABELS: Record<string, string> = {
  external_side_effect: "会改动外部数据",
  dangerous: "高风险操作",
  write: "会写入数据",
  read: "只读",
};

/** 挡位说明：用户看到「这次为什么问了 / 为什么没问」要能一眼对上设置里的那一档。 */
const POLICY_NOTES: Record<string, string> = {
  always: "当前档位：每次确认（非只读的 MCP 调用都要你点一次）。",
  trusted: "当前档位：标准信任（导航、截图这类不改动外部数据的动作不问；提交、付款、删除这类不可逆操作仍然会问）。",
  full: "当前档位：完全访问（所有 MCP 调用直接执行，不再询问）。",
};

type Props = {
  approval: AgentApproval;
  /**
   * 结果交回父组件：卡片自己不留状态，
   * 刷新后由消息上存下来的结果继续显示，避免刷新一次按钮又冒出来。
   */
  onResolved?: (outcome: AgentApprovalOutcome) => void;
};

/**
 * 待到确认的外部操作（任务书 §12）。
 *
 * 用户必须看到「将要发生什么」：哪个服务、哪个工具、什么风险、参数是什么。
 * 这里只提供「允许本次 / 拒绝」两个动作：要不要「以后不再问」是审批档位与工具记忆的事，
 * 那些在 MCP 面板里改（每个工具一行「以后直接允许 / 直接拒绝」），卡片不就地开后门。
 */
export default function AgentApprovalCard({ approval, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expired = Number(approval?.expiresAt || 0) <= Date.now();
  const calls = Array.isArray(approval?.calls) ? approval.calls : [];
  const policyNote = POLICY_NOTES[String(approval?.policy || "")] || "";

  async function decide(action: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await resumeAgentRun(approval.id, action);
      onResolved?.({
        message: String(result.message || (result.rejected ? "已取消这一步操作，没有执行。" : "已执行完成。")),
        rejected: result.rejected,
        mcpTools: result.mcpTools,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "这一步没有执行成功。");
      setBusy(false);
    }
  }


  return (
    <div className="agent-approval">
      <div className="agent-approval-head">
        <span className="agent-approval-mark" aria-hidden="true">!</span>
        <div>
          <strong>这一步需要你确认</strong>
          <small>{String(approval?.message || "助手想执行一个有副作用的操作。")}</small>
        </div>
      </div>
      {calls.length ? (
        <ul className="agent-approval-calls">
          {calls.map((call) => (
            <li key={call.id}>
              <span className="agent-approval-server">{call.server}</span>
              <code>{call.tool}</code>
              <em>{RISK_LABELS[call.risk] || call.risk}</em>
              <small>{call.reason}</small>
              {call.argsPreview ? <small className="agent-approval-args">{call.argsPreview}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {expired ? (
        <p className="agent-approval-note">这条确认已经过期，需要重新说一次需求。</p>
      ) : (
        <div className="agent-approval-actions">
          <button type="button" className="approve" disabled={busy} onClick={() => void decide("approve")}>
            {busy ? "正在执行…" : "允许本次"}
          </button>
          <button type="button" className="reject" disabled={busy} onClick={() => void decide("reject")}>
            拒绝
          </button>
        </div>
      )}
      {policyNote ? <p className="agent-approval-note">{policyNote}</p> : null}
      <p className="agent-approval-note">只执行这一次，不会自动重试；确认内容 10 分钟后作废。</p>
      {error ? <p className="agent-approval-error">{error}</p> : null}
    </div>
  );
}

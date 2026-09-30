type AgentApprovalResultProps = {
  message: string;
};

/** Approval outcome presentation; resolution and outcome text remain page-owned. */
export default function AgentApprovalResult({ message }: AgentApprovalResultProps) {
  return <div className="message-approval-result">{message}</div>;
}

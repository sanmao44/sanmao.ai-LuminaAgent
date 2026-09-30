type AgentMessagePendingProps = {
  content: string;
  elapsedSeconds?: number;
};

/** Pending reply presentation; elapsed-time calculation and lifecycle remain page-owned. */
export default function AgentMessagePending({ content, elapsedSeconds }: AgentMessagePendingProps) {
  return (
    <div className="message-pending">
      <span className="mini-loader" aria-hidden="true" />
      <p className="pending">{content}</p>
      {elapsedSeconds !== undefined ? <span className="message-pending-clock">{elapsedSeconds}s</span> : null}
    </div>
  );
}

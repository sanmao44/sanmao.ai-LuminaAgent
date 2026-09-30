type AgentMessageErrorProps = {
  message: string;
  onRetryAutomatic: () => void;
  onRetryCurrent: () => void;
};

/** Failed Agent reply affordance; retry selection and execution remain page-owned. */
export default function AgentMessageError({ message, onRetryAutomatic, onRetryCurrent }: AgentMessageErrorProps) {
  return (
    <div className="message-agent-error">
      <p>{message}</p>
      <small>模型没有返回可用回复，可以切换自动模式重试。</small>
      <div className="message-agent-error-actions">
        <button type="button" onClick={onRetryAutomatic}>切换自动并重试</button>
        <button type="button" onClick={onRetryCurrent}>重试当前模型</button>
      </div>
    </div>
  );
}

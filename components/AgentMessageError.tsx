type AgentMessageErrorProps = {
  message: string;
  retrying?: boolean;
  disabled?: boolean;
  onRetryAutomatic: () => void;
  onRetryCurrent: () => void;
};

/** Failed Agent reply affordance; retry selection and execution remain page-owned. */
export default function AgentMessageError({ message, retrying = false, disabled = false, onRetryAutomatic, onRetryCurrent }: AgentMessageErrorProps) {
  return (
    <div className="message-agent-error">
      <p>{message}</p>
      <small role={retrying ? 'status' : undefined} aria-live={retrying ? 'polite' : undefined}>
        {retrying ? '正在重试，当前回复会保留；完成后替换为新版本。' : '模型没有返回可用回复，可以重试当前模型或切换自动模式。'}
      </small>
      <div className="message-agent-error-actions">
        <button type="button" disabled={disabled || retrying} onClick={onRetryAutomatic}>切换自动并重试</button>
        <button type="button" disabled={disabled || retrying} onClick={onRetryCurrent}>重试当前模型</button>
      </div>
    </div>
  );
}

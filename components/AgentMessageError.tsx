type AgentMessageErrorProps = {
  message: string;
  retrying?: boolean;
  disabled?: boolean;
  onRetryAutomatic: () => void;
  onRetryCurrent: () => void;
};

function recoveryGuidance(message: string) {
  // Errors currently arrive as text; these hints do not change retry policy.
  if (/\b(?:context_length_exceeded|AGENT_CONTEXT_BUDGET_EXCEEDED)\b|当前请求的必要内容超过模型请求预算|maximum context length|context length exceeded/i.test(message)) {
    return '请减少本轮输入或附件、缩短对话历史，或改用上下文更大的模型；原样重试可能再次失败。';
  }
  // A bare 413 may be part of a request ID, so require an explicit HTTP label.
  if (/请求内容超过服务商限制|请求内容过大|请求体过大|\bHTTP\s+413\b|\b(?:request entity too large|payload too large)\b/i.test(message)) {
    return '请先缩短本轮输入或减少附件，再重试；原样重试可能再次失败。';
  }
  return '本次请求未完成。请根据上方原因调整输入或设置后重试，也可以切换自动模式。';
}

/** Failed Agent reply affordance; retry selection and execution remain page-owned. */
export default function AgentMessageError({ message, retrying = false, disabled = false, onRetryAutomatic, onRetryCurrent }: AgentMessageErrorProps) {
  return (
    <div className="message-agent-error">
      <p>{message}</p>
      <small role={retrying ? 'status' : undefined} aria-live={retrying ? 'polite' : undefined}>
        {retrying ? '正在重试，当前回复会保留；完成后替换为新版本。' : recoveryGuidance(message)}
      </small>
      <div className="message-agent-error-actions">
        <button type="button" disabled={disabled || retrying} onClick={onRetryAutomatic}>切换自动并重试</button>
        <button type="button" disabled={disabled || retrying} onClick={onRetryCurrent}>重试当前模型</button>
      </div>
    </div>
  );
}

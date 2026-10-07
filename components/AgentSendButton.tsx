import type { ComponentType } from 'react';

type AgentSendButtonProps = {
  busy: boolean;
  disabled: boolean;
  title: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onSend: () => void;
  onStop: () => void;
};

/** Send/stop affordance; busy transitions and validation remain page-owned. */
export default function AgentSendButton({ busy, disabled, title, Icon, onSend, onStop }: AgentSendButtonProps) {
  return (
    <button
      type="button"
      className={`send-button ${busy ? 'stop-button' : ''}`}
      disabled={disabled}
      onClick={busy ? onStop : onSend}
      title={title}
      aria-label={busy ? '停止当前回答' : '发送'}
    >
      <Icon name={busy ? 'stop' : 'send'} size={18} />
    </button>
  );
}

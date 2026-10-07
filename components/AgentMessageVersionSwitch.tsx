import type { ComponentType } from 'react';

type AgentMessageVersionSwitchProps = {
  index: number;
  total: number;
  retrying: boolean;
  Icon: ComponentType<{ name: string; size?: number }>;
  onPrevious: () => void;
  onNext: () => void;
};

/** Version navigation affordance; message version state and switching remain page-owned. */
export default function AgentMessageVersionSwitch({ index, total, retrying, Icon, onPrevious, onNext }: AgentMessageVersionSwitchProps) {
  return (
    <div className="message-version-switch">
      <button type="button" disabled={retrying || index === 0} onClick={onPrevious} aria-label="查看上一版">
        <Icon name="left" size={13} />
      </button>
      <span>{index + 1} / {total}</span>
      <button type="button" disabled={retrying || index >= total - 1} onClick={onNext} aria-label="查看下一版">
        <Icon name="right" size={13} />
      </button>
    </div>
  );
}

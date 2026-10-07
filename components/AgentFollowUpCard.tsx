import type { ComponentType } from 'react';

type AgentFollowUpCardProps = {
  role: 'assistant' | 'user';
  content: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onClear: () => void;
};

/** Quoted Agent follow-up context; the active quote remains page-owned. */
export default function AgentFollowUpCard({ role, content, Icon, onClear }: AgentFollowUpCardProps) {
  return (
    <div className="agent-followup-card">
      <span className="agent-followup-mark"><Icon name="agent" size={14} /></span>
      <div>
        <small>正在追问 {role === 'assistant' ? '助手回复' : '你的消息'}</small>
        <strong title={content}>{content.replace(/\s+/g, ' ').trim()}</strong>
      </div>
      <button type="button" title="取消引用" aria-label="取消引用" onClick={onClear}><Icon name="close" size={15} /></button>
    </div>
  );
}

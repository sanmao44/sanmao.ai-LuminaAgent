import type { AgentOrbState } from '@/components/AgentOrb';
import AgentOrb from '@/components/AgentOrb';

type AgentMessageAvatarProps = {
  role: 'assistant' | 'user';
  pending: boolean;
  orbState: AgentOrbState;
};

/** Message identity marker; message lifecycle and status remain page-owned. */
export default function AgentMessageAvatar({ role, pending, orbState }: AgentMessageAvatarProps) {
  return (
    <div className={`message-avatar ${role === 'assistant' && pending ? 'message-avatar-orb' : ''}`}>
      {role === 'user'
        ? '你'
        : pending
          ? <AgentOrb state={orbState} size={26} speed={1.15} label="" />
          : <img src="/brand-mark-welcome.png" alt="SANMAO.AI" />}
    </div>
  );
}

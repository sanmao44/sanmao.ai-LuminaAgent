import type { AgentOrbState } from '@/components/AgentOrb';
import AgentOrb from '@/components/AgentOrb';

type AgentOrbStatusProps = {
  phase: AgentOrbState;
  title: string;
  detail: string;
};

/** Live Agent status affordance; state calculation remains owned by the page. */
export default function AgentOrbStatus({ phase, title, detail }: AgentOrbStatusProps) {
  const isError = phase === 'error';

  return (
    <div
      className={`agent-orb-status ${isError ? 'agent-orb-status-error' : ''}`}
      role="status"
      aria-live="polite"
      title={detail}
    >
      <AgentOrb state={phase} size={22} label="" />
      <span>{title}</span>
    </div>
  );
}

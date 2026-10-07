type AgentIntentClarifyCardProps = {
  summary: string;
  onChoose: (deliverable: 'IMAGE' | 'TEXT' | 'BOTH') => void;
};

/** Clarification affordance for ambiguous Agent deliverables. */
export default function AgentIntentClarifyCard({ summary, onChoose }: AgentIntentClarifyCardProps) {
  return (
    <div className="agent-intent-card clarify-only" role="status" aria-live="polite">
      <div className="agent-intent-copy">
        <div className="agent-intent-title">
          <span className="agent-intent-pulse" aria-hidden="true" />
          <strong>请确认交付形式</strong>
        </div>
        <p>{summary}</p>
      </div>
      <div className="agent-intent-choices">
        {([['IMAGE', '直接出图'], ['TEXT', '先写文案'], ['BOTH', '图和文案都要']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => onChoose(value)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

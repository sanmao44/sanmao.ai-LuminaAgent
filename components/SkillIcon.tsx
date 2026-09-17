type SkillIconProps = { size?: number };

export default function SkillIcon({ size = 16 }: SkillIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.6 4.6H9.7a2.3 2.3 0 0 1 4.6 0H17.4a1.6 1.6 0 0 1 1.6 1.6V9.7a2.3 2.3 0 0 0 0 4.6V17.4a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 17.4V6.2A1.6 1.6 0 0 1 6.6 4.6Z" />
    </svg>
  );
}

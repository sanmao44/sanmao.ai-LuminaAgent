import type { PropsWithChildren } from 'react';

/** Message header layout shell; status decisions and interactions remain page-owned. */
export default function AgentMessageLabel({ children }: PropsWithChildren) {
  return <div className="message-label">{children}</div>;
}

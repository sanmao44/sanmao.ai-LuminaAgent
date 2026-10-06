import type { AgentClientFile } from '../agent-client';
import type { ChatHistoryMessage } from '../client-history';

export type AgentArtifactReference = Pick<
  AgentClientFile,
  'name' | 'mimeType' | 'artifactId' | 'size'
>;

/** Project persisted artifact metadata into the bounded Agent history input. */
export function historyArtifactFiles(
  message: Pick<ChatHistoryMessage, 'role' | 'files'> | null | undefined,
): AgentArtifactReference[] {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.files)) return [];
  return message.files
    .filter((file) => file && typeof file.artifactId === 'string' && !file.content)
    .slice(0, 8)
    .map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      artifactId: file.artifactId,
      size: file.size,
    }));
}

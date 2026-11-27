import type { ChatHistoryMessage, ChatSession } from '@/lib/client-history';
import type { AgentFilesystemUndo } from '@/packages/contracts/agent';

export type AgentApprovalSessionOutcome = {
  message?: unknown;
  rejected?: boolean;
  mcpTools?: unknown[];
  filesystemUndos?: AgentFilesystemUndo[];
};

type ApprovalCall = {
  filesystemDiff?: unknown;
  [key: string]: unknown;
};

type ApprovalMessage = ChatHistoryMessage & {
  approval?: {
    id?: string;
    message?: unknown;
    calls?: ApprovalCall[];
  };
  approvalResult?: string;
  resolvedApprovalId?: string;
  filesystemUndos?: AgentFilesystemUndo[];
  mcpTools?: unknown[];
};

export type AgentApprovalSession = Omit<ChatSession, 'messages'> & {
  messages: ApprovalMessage[];
};

function approvalIdentity(message: ApprovalMessage) {
  if (message.approval) return message.approval.id;
  if (message.resolvedApprovalId) return message.resolvedApprovalId;
  // Older messages only stored their undo receipts. Remember the original receipt ID before removing it.
  const receiptId = message.filesystemUndos?.[0]?.id;
  return typeof receiptId === 'string' && receiptId ? `undo-receipt:${receiptId}` : undefined;
}

function hasDuplicateFileApprovalPrompt(message: ApprovalMessage) {
  return message.content === message.approval?.message
    && message.approval?.calls?.some((call) => Boolean(call.filesystemDiff));
}

/**
 * Resolve one approval result in the session that created it.
 * Returns null when the session or message no longer exists.
 */
export function applyApprovalOutcomeToSession(
  session: AgentApprovalSession,
  messageId: string,
  outcome: AgentApprovalSessionOutcome | null | undefined,
  now = Date.now(),
  origin?: ApprovalMessage,
): AgentApprovalSession | null {
  const originId = origin ? approvalIdentity(origin) : undefined;
  let resolved = false;
  const messages = session.messages.map((item) => {
    if (item.id !== messageId) return item;
    const operationId = approvalIdentity(item);
    if (origin && operationId !== originId) return item;
    resolved = true;
    return {
      ...item,
      ...(hasDuplicateFileApprovalPrompt(item) ? { content: '' } : {}),
      approval: undefined,
      resolvedApprovalId: operationId,
      filesystemUndos: outcome?.filesystemUndos,
      approvalResult: String(outcome?.message || (outcome?.rejected ? '已取消这一步操作，没有执行。' : '已执行完成。')),
      mcpTools: Array.isArray(outcome?.mcpTools) && outcome.mcpTools.length
        ? [...(item.mcpTools || []), ...outcome.mcpTools]
        : item.mcpTools,
    };
  });
  if (!resolved) return null;
  return { ...session, updatedAt: now, messages };
}

/** Preserve durable approval results when an in-flight generation saves an older message snapshot. */
export function mergeResolvedApprovalOutcomes(
  messages: readonly ApprovalMessage[],
  persistedMessages: readonly ApprovalMessage[],
): ApprovalMessage[] {
  const resolvedById = new Map(
    persistedMessages
      .filter((item) => !item.approval && typeof item.resolvedApprovalId === 'string' && item.resolvedApprovalId)
      .map((item) => [item.id, item] as const),
  );
  if (!resolvedById.size) return [...messages];
  return messages.map((item) => {
    const resolved = resolvedById.get(item.id);
    if (!resolved || approvalIdentity(item) !== resolved.resolvedApprovalId) return item;
    return {
      ...item,
      ...(hasDuplicateFileApprovalPrompt(item) ? { content: '' } : {}),
      approval: undefined,
      approvalResult: resolved.approvalResult,
      resolvedApprovalId: resolved.resolvedApprovalId,
      filesystemUndos: resolved.filesystemUndos,
      mcpTools: resolved.mcpTools,
    };
  });
}

/** Serialize mutations for one conversation without blocking other conversations. */
export function queueSessionMutation<T>(
  queues: Map<string, Promise<unknown>>,
  id: string,
  mutation: () => Promise<T> | T,
): Promise<T> {
  const previous = queues.get(id) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(mutation);
  queues.set(id, operation);
  return operation.finally(() => {
    if (queues.get(id) === operation) queues.delete(id);
  });
}

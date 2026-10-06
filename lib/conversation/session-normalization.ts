import type {
  ChatHistoryMessage,
  ChatMessageVersion,
  ChatSession,
  GalleryItem,
} from '../client-history';

type ConversationVersionFields = {
  task?: string;
  durationSeconds?: number;
};

type ConversationMessage = Omit<ChatHistoryMessage, 'versions'> & {
  pending?: boolean;
  pendingSince?: number;
  activity?: unknown;
  retrying?: boolean;
  task?: string;
  durationSeconds?: number;
  versions?: Array<ChatMessageVersion & ConversationVersionFields>;
};

type ConversationVersion = ChatMessageVersion & ConversationVersionFields;

/** Restore the agent-owned image source marker used by the conversation UI. */
export function normalizeAssistantImageSources(
  inputMessages: readonly ConversationMessage[],
): ConversationMessage[] {
  return inputMessages.map((message) => message.role === 'assistant' && message.images?.length
    ? {
        ...message,
        images: message.images.map((item: GalleryItem) => item.source === 'agent'
          ? item
          : { ...item, source: 'agent' }),
      }
    : message);
}

function normalizeVersionImageSources(
  versions: ConversationVersion[],
): ConversationVersion[] {
  return versions.map((version) => version.images?.length
    ? {
        ...version,
        images: version.images.map((item) => item.source === 'agent'
          ? item
          : { ...item, source: 'agent' }),
      }
    : version);
}

/** Return stored versions, or the legacy single-version projection. */
export function messageVersionsFor(message: ConversationMessage): ConversationVersion[] {
  if (message.role !== 'assistant' || !message.versions?.length) {
    return [{
      id: `${message.id}-v1`,
      content: message.content,
      images: message.images,
      files: message.files,
      interrupted: message.interrupted,
      webSearch: message.webSearch,
      webSearchDecision: message.webSearchDecision,
      task: message.task,
      durationSeconds: message.durationSeconds,
      createdAt: 0,
    }];
  }
  return message.versions;
}

/** Clamp the selected version to the versions that can actually be displayed. */
export function messageVersionIndex(message: ConversationMessage): number {
  const versions = messageVersionsFor(message);
  return Math.min(
    Math.max(0, message.activeVersion ?? versions.length - 1),
    versions.length - 1,
  );
}

/** Project one stored version onto the message while preserving message metadata. */
export function applyMessageVersion(
  message: ConversationMessage,
  versions: readonly ConversationVersion[],
  activeVersion: number,
  retrying = false,
): ConversationMessage {
  const version = versions[activeVersion];
  return {
    ...message,
    content: version.content,
    images: version.images,
    files: version.files,
    interrupted: version.interrupted,
    webSearch: version.webSearch ?? message.webSearch,
    webSearchDecision: version.webSearchDecision ?? message.webSearchDecision,
    task: version.task ?? message.task,
    durationSeconds: version.durationSeconds ?? message.durationSeconds,
    versions: [...versions],
    activeVersion,
    retrying,
  };
}

/** Normalize persisted conversation records without owning persistence or UI state. */
export function normalizeChatSession(
  session: ChatSession & { messages: ConversationMessage[] },
  fallbackProjectId: string,
): ChatSession & { messages: ConversationMessage[] } {
  const messages = normalizeAssistantImageSources(session.messages).map((message) => {
    // Pending messages are transient UI state. If one was persisted by an
    // older build or restored after a crash, make it explicitly interrupted.
    if (message.pending) {
      const {
        pending: _pending,
        activity: _activity,
        pendingSince: _pendingSince,
        ...rest
      } = message;
      return {
        ...rest,
        content: String(rest.content || '').trim() || '本轮回答在页面刷新或重启后中断。',
        interrupted: true,
      };
    }
    if (message.role !== 'assistant' || !message.versions?.length) return message;
    const versions = normalizeVersionImageSources(message.versions);
    const activeVersion = Math.min(
      Math.max(0, message.activeVersion ?? versions.length - 1),
      versions.length - 1,
    );
    return applyMessageVersion({ ...message, versions }, versions, activeVersion);
  });
  const projectId = typeof session.projectId === 'string' && session.projectId.trim()
    ? session.projectId.trim()
    : fallbackProjectId;
  return { ...session, projectId, messages };
}

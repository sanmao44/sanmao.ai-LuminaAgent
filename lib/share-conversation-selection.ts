export type ShareSelectionMessage = {
  id?: string;
  role?: string;
  pending?: boolean;
  content?: string;
  images?: unknown[];
  references?: unknown[];
  files?: unknown[];
};

export type ShareConversationGroup = {
  id: string;
  index: number;
  label: string;
  messages: ShareSelectionMessage[];
  messageIds: string[];
  complete: boolean;
  selectable: boolean;
};

function hasShareableContent(message: ShareSelectionMessage) {
  return Boolean(
    message.content?.trim() ||
    message.images?.length ||
    message.references?.length ||
    message.files?.length,
  );
}

function createGroup(messages: ShareSelectionMessage[], index: number): ShareConversationGroup {
  const firstId = messages[0]?.id || `message-${index}`;
  const complete = messages.every((message) => !message.pending);
  const hasContent = messages.some(hasShareableContent);
  return {
    id: `share-group-${firstId}`,
    index,
    label: `第 ${index + 1} 组问答`,
    messages,
    messageIds: messages.map((message, messageIndex) => message.id || `message-${index}-${messageIndex}`),
    complete,
    selectable: complete && hasContent,
  };
}

/** Groups a conversation as user + following assistant reply, with assistant-only messages kept standalone. */
export function buildShareConversationGroups(messages: ShareSelectionMessage[] = []) {
  const groups: ShareConversationGroup[] = [];
  let current: ShareSelectionMessage[] = [];

  const flush = () => {
    if (!current.length) return;
    groups.push(createGroup(current, groups.length));
    current = [];
  };

  messages.forEach((message) => {
    if (message.role === 'user') {
      flush();
      current = [message];
      return;
    }

    if (current.length && current[0].role === 'user' && !current.some((item) => item.role !== 'user')) {
      current.push(message);
      flush();
      return;
    }

    flush();
    current = [message];
    flush();
  });

  flush();
  return groups;
}

export function flattenSelectedShareMessages(groups: ShareConversationGroup[], selectedIds: Set<string>) {
  return groups
    .filter((group) => group.selectable && selectedIds.has(group.id))
    .flatMap((group) => group.messages);
}

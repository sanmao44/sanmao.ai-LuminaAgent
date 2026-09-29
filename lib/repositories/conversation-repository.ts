'use client';

import {
  listChatSessions,
  removeChatSession,
  replaceChatSessions,
  saveChatSession,
  type ChatSession,
} from '../client-history';
import type { ConversationRepository } from './types';

/**
 * TEMPORARY MIGRATION ADAPTER: IndexedDB-backed conversation history.
 *
 * Remove this adapter when the client-history implementation is replaced by a
 * storage implementation behind the same port. Callers must not access the
 * IndexedDB store directly through the repository boundary.
 */
export const conversationRepository: ConversationRepository = {
  list: listChatSessions,
  async get(id) {
    return (await listChatSessions()).find((session) => session.id === id) || null;
  },
  save: saveChatSession,
  remove: removeChatSession,
  replaceAll: replaceChatSessions,
};

export type { ChatSession };

import type { ConversationMemory, MemoryMessage } from "@/lib/agent-memory";
import {
  editConversationMemory,
  prepareConversationMemory,
  selectRelevantConversationMessages,
  validConversationMemory,
} from "@/lib/agent-memory";
import type { WorkspaceContext } from "@/lib/workspace-context";

export const CANVAS_AGENT_DOCK_SESSION_KEY = "sanmao.canvas.agentdock.session.v1";
export const LEGACY_CANVAS_AGENT_DOCK_SESSION_KEY = CANVAS_AGENT_DOCK_SESSION_KEY;
export const CANVAS_AGENT_DOCK_MAX_MESSAGES = 40;

export type CanvasAgentDockMemory = ConversationMemory & {
  /** Number of summarized messages archived from the visible transcript. */
  archivedPrefixCount: number;
};

export function canvasAgentDockSessionKey(context: Pick<WorkspaceContext, "creativeProjectId" | "canvasId">) {
  const projectId = encodeURIComponent(String(context.creativeProjectId || "default").trim() || "default");
  const canvasId = encodeURIComponent(String(context.canvasId || "default").trim() || "default");
  return `${CANVAS_AGENT_DOCK_SESSION_KEY}:${projectId}:${canvasId}`;
}

export function validCanvasAgentDockMemory(
  memory: CanvasAgentDockMemory | undefined,
  messages: MemoryMessage[],
): memory is CanvasAgentDockMemory {
  return Boolean(memory
    && Number.isInteger(memory.archivedPrefixCount)
    && memory.archivedPrefixCount >= 0
    && validConversationMemory(memory, messages));
}

export async function prepareCanvasAgentDockMemory(
  messages: MemoryMessage[],
  previous: CanvasAgentDockMemory | undefined,
  summarize: (summary: string, transcript: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<CanvasAgentDockMemory> {
  const valid = validCanvasAgentDockMemory(previous, messages) ? previous : undefined;
  const prepared = await prepareConversationMemory(messages, valid, summarize, signal);
  return { ...prepared, archivedPrefixCount: prepared.summary ? valid?.archivedPrefixCount || 0 : 0 };
}

export function editCanvasAgentDockMemory(
  messages: MemoryMessage[],
  summary: string,
  previous?: CanvasAgentDockMemory,
): CanvasAgentDockMemory {
  const edited = editConversationMemory(messages, summary);
  return {
    ...edited,
    archivedPrefixCount: summary.trim() ? previous?.archivedPrefixCount || 0 : 0,
  };
}

/**
 * Keep the visible dock transcript bounded once every removed message is
 * represented by the summary. If summarization failed, retain the messages
 * instead of silently discarding context.
 */
export function pruneCanvasAgentDockMessages(
  messages: readonly MemoryMessage[],
  memory: CanvasAgentDockMemory | undefined,
  limit = CANVAS_AGENT_DOCK_MAX_MESSAGES,
) {
  if (messages.length <= limit) return { messages: [...messages], memory };
  const removeCount = messages.length - limit;
  if (!memory?.summary || !validCanvasAgentDockMemory(memory, [...messages]) || memory.covered.length < removeCount)
    return { messages: [...messages], memory };
  return {
    messages: messages.slice(removeCount),
    memory: {
      ...memory,
      covered: memory.covered.slice(removeCount),
      archivedPrefixCount: memory.archivedPrefixCount + removeCount,
    },
  };
}

export function selectCanvasAgentDockContext(messages: MemoryMessage[], query: string) {
  return selectRelevantConversationMessages(messages, query, 8, 3, 11);
}

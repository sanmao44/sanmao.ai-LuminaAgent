import type { CanvasPatch } from '@/lib/canvas/patch';

export type GeneratedFile = { name: string; size: number; [key: string]: unknown };
export type ToolCall = { id?: string; function?: { name?: string; arguments?: string } };
export type RuntimeImage = {
  provider: unknown;
  model: { id: string; rawId: string; displayName: string };
  itemRuntime?: RuntimeImage;
  batchIndex?: number;
  batchPrompt?: string;
  url?: string;
  [key: string]: unknown;
};

/** Mutable turn-local state shared by capability ports. */
export type ToolRuntimeState = {
  webSearchData?: unknown;
  webSearchError?: string;
  generatedFiles: GeneratedFile[];
  canvasPatch?: CanvasPatch;
  mcpToolCallCount: number;
  mcpTurnBudget: number;
  usedMcpTools: Array<Record<string, unknown>>;
  browserUses: Array<Record<string, unknown>>;
  browserRecoveryNeeded: boolean;
  generated: Array<Record<string, unknown>>;
  browserDownloadCount: number;
  stalledMcpReason: string;
  preparedCaption?: unknown;
  batchItems: Array<Record<string, unknown>>;
  generations: Array<Record<string, unknown>>;
  recentPageText: string;
  skillToolCalls: number;
  skillInstalls: number;
  generatedArtifactCount: number;
  usedSkills: Array<{ id: string; name: string }>;
};

export type ToolCallRun = { results: import('@/lib/providers').ChatMessage[]; deferred?: true; stalled?: true };

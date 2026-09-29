import type { ModelDescriptor, ModelMessage, ModelResponse, ModelRuntime } from '../../packages/contracts/model';

type LegacyChatResponse = {
  model?: unknown;
  model_id?: unknown;
  data?: { model?: unknown; model_id?: unknown };
  choices?: Array<{ message?: { content?: unknown } }>;
};

export type LegacyChatInvoker = (messages: readonly ModelMessage[], signal?: AbortSignal) => Promise<unknown>;

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => textFromContent(item)).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text.trim();
  if (typeof item.content === 'string') return item.content.trim();
  if (Array.isArray(item.content)) return textFromContent(item.content);
  return '';
}

function upstreamModel(response: LegacyChatResponse) {
  const candidates = [response.model, response.model_id, response.data?.model, response.data?.model_id];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return value ? String(value).trim() : undefined;
}

function normalizeLegacyResponse(response: unknown): ModelResponse {
  const payload = response && typeof response === 'object' ? response as LegacyChatResponse : {};
  const modelId = upstreamModel(payload);
  return {
    content: textFromContent(payload.choices?.[0]?.message?.content),
    ...(modelId ? { modelId } : {}),
  };
}

/**
 * TEMPORARY MIGRATION ADAPTER
 *
 * Bridges the existing OpenAI-compatible chat response shape into the stable
 * ModelRuntime contract. The invoker remains supplied by the HTTP adapter so
 * its existing timeout, metrics and failover policy stay unchanged.
 */
export function createLegacyChatModelRuntime(input: {
  descriptor: ModelDescriptor;
  invoke: LegacyChatInvoker;
}): ModelRuntime {
  const invoke = async (request: { runId: string; messages: readonly ModelMessage[]; signal?: AbortSignal }) => (
    normalizeLegacyResponse(await input.invoke(request.messages, request.signal))
  );
  return {
    descriptor: input.descriptor,
    provider: { invoke: async (request) => invoke(request) },
    invoke,
  };
}

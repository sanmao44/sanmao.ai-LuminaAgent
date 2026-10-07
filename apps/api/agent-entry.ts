import { AgentRuntime } from '../../packages/agent-core/runtime';
import type { AgentMessage, AgentResult, ModelDescriptor, ModelRuntime, RuntimeObserver } from '../../packages/contracts';

export type PlainAgentTurn = {
  runId: string;
  model: ModelDescriptor;
  runtime: ModelRuntime;
  messages: readonly AgentMessage[];
  signal?: AbortSignal;
  observer?: RuntimeObserver;
};

/** API application entry for the migrated provider-neutral text slice. */
export async function runPlainAgentTurn(input: PlainAgentTurn): Promise<AgentResult> {
  const runtime = new AgentRuntime({
    model: input.runtime,
    context: { build: (request) => request.messages },
    policy: { decide: () => ({ allowed: true }) },
    observer: input.observer,
  });
  return runtime.run({
    runId: input.runId,
    model: input.model,
    messages: input.messages,
    signal: input.signal,
  });
}

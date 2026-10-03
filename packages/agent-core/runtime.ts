import type {
  AgentEvent,
  AgentPolicy,
  AgentRequest,
  AgentResult,
  AgentRunState,
  ContextBuilder,
  ModelRuntime,
  RuntimeObserver,
} from '../contracts';

export type AgentRuntimeDependencies = {
  model: ModelRuntime;
  context: ContextBuilder;
  policy: AgentPolicy;
  now?: () => number;
  observer?: RuntimeObserver;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Small, provider-neutral AgentRun executor for the first migration slice.
 * Tool execution and persistence remain explicit ports for later slices.
 */
export class AgentRuntime {
  private readonly now: () => number;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.now = dependencies.now || Date.now;
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    const events: AgentEvent[] = [];
    let state: AgentRunState = 'created';
    const startedAt = this.now();
    void this.dependencies.observer?.emit({ operationId: request.runId, kind: 'agent', phase: 'started', at: startedAt });
    events.push({ type: 'AgentRunStarted', runId: request.runId, at: startedAt });

    const decision = this.dependencies.policy.decide(request);
    if (!decision.allowed) {
      const error = decision.reason || 'Agent run is not allowed';
      state = 'failed';
      events.push({ type: 'AgentRunFailed', runId: request.runId, at: this.now(), error });
      throw new Error(error);
    }

    state = 'running';
    const messages = this.dependencies.context.build(request);
    events.push({ type: 'ModelInvocationStarted', runId: request.runId, at: this.now() });
    try {
      const response = await this.dependencies.model.invoke({
        runId: request.runId,
        messages,
        signal: request.signal,
      });
      events.push({
        type: 'ModelInvocationCompleted',
        runId: request.runId,
        at: this.now(),
        outputChars: response.content.length,
      });
      state = 'completed';
      void this.dependencies.observer?.emit({ operationId: request.runId, kind: 'agent', phase: 'completed', at: this.now(), durationMs: this.now() - startedAt, status: state, identity: response.modelId });
      events.push({ type: 'AgentRunCompleted', runId: request.runId, at: this.now() });
      return { run: { id: request.runId, state }, output: response.content, modelId: response.modelId, events };
    } catch (error) {
      state = request.signal?.aborted ? 'cancelled' : 'failed';
      void this.dependencies.observer?.emit({ operationId: request.runId, kind: 'agent', phase: 'failed', at: this.now(), durationMs: this.now() - startedAt, status: state, errorClass: error instanceof Error ? error.name : 'UnknownError' });
      events.push({ type: 'AgentRunFailed', runId: request.runId, at: this.now(), error: errorText(error) });
      throw error;
    }
  }
}

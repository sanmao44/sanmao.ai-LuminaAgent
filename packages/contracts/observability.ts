/** Provider and transport neutral runtime telemetry contract. */
export type RuntimeOperationKind = 'agent' | 'tool' | 'mcp' | 'provider' | 'task' | 'database' | 'backup';

export type RuntimeEvent = {
  operationId: string;
  kind: RuntimeOperationKind;
  phase: 'started' | 'completed' | 'failed';
  at: number;
  durationMs?: number;
  status?: string;
  identity?: string;
  errorClass?: string;
  retry?: number;
};

export interface RuntimeObserver {
  emit(event: RuntimeEvent): void | Promise<void>;
}

export function observeStarted(observer: RuntimeObserver | undefined, input: Pick<RuntimeEvent, 'operationId' | 'kind' | 'identity'>, at = Date.now()) {
  void observer?.emit({ ...input, phase: 'started', at });
}

export function observeCompleted(observer: RuntimeObserver | undefined, input: Pick<RuntimeEvent, 'operationId' | 'kind' | 'identity'> & { status?: string; startedAt: number }, at = Date.now()) {
  const { startedAt, ...event } = input;
  void observer?.emit({ ...event, phase: 'completed', at, durationMs: Math.max(0, at - startedAt) });
}

export function observeFailed(observer: RuntimeObserver | undefined, input: Pick<RuntimeEvent, 'operationId' | 'kind' | 'identity'> & { status?: string; errorClass?: string; startedAt: number }, at = Date.now()) {
  const { startedAt, ...event } = input;
  void observer?.emit({ ...event, phase: 'failed', at, durationMs: Math.max(0, at - startedAt) });
}

/** A bounded in-process observer for tests and local diagnostics. It never
 * stores prompt, tool arguments, response content, or secrets. */
export class BufferedRuntimeObserver implements RuntimeObserver {
  private readonly events: RuntimeEvent[] = [];
  constructor(private readonly maxEvents = 1000) {}
  emit(event: RuntimeEvent) {
    this.events.push({ ...event });
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }
  snapshot() { return this.events.map((event) => ({ ...event })); }
}

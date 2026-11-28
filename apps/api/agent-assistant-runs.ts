import { createHash, randomUUID } from 'node:crypto';
import type { AgentAssistantRunAction, AgentAssistantRunReply } from '@/packages/contracts/agent';
import { createTaskRepository } from '@/lib/repositories/task-repository';
import type { AgentApplicationOutput, AgentAssistantExecutionControl } from './agent-application-contract';
import type { AgentHttpInput } from './agent-http-contract';

export type AgentAssistantRunInvoker = (
  input: AgentHttpInput,
  execution: AgentAssistantExecutionControl,
) => Promise<AgentApplicationOutput>;

export type AgentAssistantRunExecutionRecord = {
  id: string;
  idempotencyKey?: string;
  createdAt: string;
  ownerHash: string;
  runId: string;
  instanceId: string;
  state: AgentAssistantRunReply['run']['state'];
  completedToolCalls: number;
  updatedAt: string;
  error?: string;
  result?: Record<string, unknown>;
};

export type AgentAssistantRunActionOutcome = AgentAssistantRunReply | null;

type Deferred = { promise: Promise<void>; resolve: () => void };
type LiveRun = {
  storageId: string;
  controller: AbortController;
  record: AgentAssistantRunExecutionRecord;
  pauseRequested: boolean;
  pauseWaiter: Deferred | null;
  writeChain: Promise<unknown>;
};

const INSTANCE_ID = randomUUID();
const store = createTaskRepository<AgentAssistantRunExecutionRecord>({
  fileName: 'agent-assistant-runs.json',
  fileMode: 0o600,
  maxList: 500,
});
const liveRuns = new Map<string, LiveRun>();

function normalizedRunId(value: string) {
  const runId = String(value || '').trim();
  return runId.length > 0 && runId.length <= 200 ? runId : null;
}

function ownerHash(owner: string) {
  return createHash('sha256').update(owner).digest('hex');
}

function storageId(ownerDigest: string, runId: string) {
  return createHash('sha256').update(ownerDigest).update('\0').update(runId).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function isActive(state: AgentAssistantRunExecutionRecord['state']) {
  return state === 'running' || state === 'pausing' || state === 'paused' || state === 'cancelling';
}

function replyOf(record: AgentAssistantRunExecutionRecord): AgentAssistantRunReply {
  return {
    run: {
      runId: record.runId,
      state: record.state,
      completedToolCalls: record.completedToolCalls,
      updatedAt: record.updatedAt,
      ...(record.error ? { error: record.error } : {}),
    },
    ...(record.result ? { result: record.result } : {}),
  };
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function writeRun(run: LiveRun, patch: Partial<AgentAssistantRunExecutionRecord>) {
  const operation = run.writeChain.then(async () => {
    const updated = await store.update(run.storageId, { ...patch, updatedAt: nowIso() });
    if (updated) run.record = updated;
    return updated;
  });
  run.writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}

function safeFailureMessage(error: unknown) {
  if (error instanceof Error && (error.name === 'AbortError' || /AGENT_CANCELLED/u.test(error.message))) return undefined;
  // Tool/provider errors may echo prompts or request material; persist a stable
  // status message instead of copying opaque error bodies into task history.
  return '助手执行失败，请检查模型或工具连接后重试。';
}

async function collectOutput(output: AgentApplicationOutput): Promise<Record<string, unknown>> {
  if (output.kind === 'json') return output.body;
  const reader = output.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let buffer = '';
  let streamedText = '';
  const finalEvent: { value: Record<string, unknown> | null } = { value: null };
  let streamError = '';
  const consume = (raw: string) => {
    buffer += raw;
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const data = frame.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.type === 'delta') streamedText += String(event.text || '');
        if (event.type === 'final') finalEvent.value = event;
        if (event.type === 'error') streamError = String(event.message || event.error || '助手流式响应失败');
      } catch {
        // Ignore malformed or non-JSON events; a valid final event is required.
      }
    }
  };
  consume(text);
  if (buffer.trim()) consume('\n\n');
  if (streamError) throw new Error('Agent stream failed');
  const final = finalEvent.value;
  if (!final) throw new Error('Agent stream did not contain a final event');
  return { ...final, message: String(final.message || streamedText || '') };
}

async function markInterrupted(record: AgentAssistantRunExecutionRecord) {
  const updated = await store.update(record.id, {
    state: 'interrupted',
    error: '服务进程已重启，当前任务无法从原执行位置继续。请检查已有产物后再决定是否重新提交。',
    updatedAt: nowIso(),
  });
  return updated || { ...record, state: 'interrupted' as const };
}

async function findOwnedRecord(owner: string, runId: string) {
  const digest = ownerHash(owner);
  const id = storageId(digest, runId);
  const record = await store.find(id);
  if (!record || record.ownerHash !== digest || record.runId !== runId) return null;
  return { id, record };
}

async function observeRecord(owner: string, runId: string): Promise<AgentAssistantRunReply | null> {
  const found = await findOwnedRecord(owner, runId);
  if (!found) return null;
  let { record } = found;
  const live = liveRuns.get(found.id);
  if (isActive(record.state) && (!live || record.instanceId !== INSTANCE_ID)) {
    record = await markInterrupted(record);
    liveRuns.delete(found.id);
  }
  return replyOf(live?.record || record);
}

/**
 * Starts one ephemeral, resumable execution. Same owner+runId is idempotent;
 * an owner mismatch is returned as null. Only lifecycle metadata and the
 * completed result are persisted; request messages, context, and credentials
 * stay in the live invocation closure.
 */
export async function startAgentAssistantRun(
  input: AgentHttpInput,
  runIdValue: string,
  owner: string,
  invoke: AgentAssistantRunInvoker,
): Promise<AgentAssistantRunActionOutcome> {
  const runId = normalizedRunId(runIdValue);
  if (!runId || !owner.trim()) return null;
  const digest = ownerHash(owner);
  const id = storageId(digest, runId);
  const existing = await store.find(id);
  if (existing) {
    if (existing.ownerHash !== digest || existing.runId !== runId) return null;
    const live = liveRuns.get(id);
    if (isActive(existing.state) && (!live || existing.instanceId !== INSTANCE_ID)) {
      return replyOf(await markInterrupted(existing));
    }
    return replyOf(live?.record || existing);
  }

  const createdAt = nowIso();
  const initial: AgentAssistantRunExecutionRecord = {
    id,
    createdAt,
    ownerHash: digest,
    runId,
    instanceId: INSTANCE_ID,
    state: 'running',
    completedToolCalls: 0,
    updatedAt: createdAt,
  };
  const inserted = await store.insert({ ...initial, idempotencyKey: id });
  if (!inserted.created) return observeRecord(owner, runId);

  const controller = new AbortController();
  const live: LiveRun = {
    storageId: id,
    controller,
    record: inserted.task,
    pauseRequested: false,
    pauseWaiter: null,
    writeChain: Promise.resolve(),
  };
  liveRuns.set(id, live);

  const execution: AgentAssistantExecutionControl = {
    now: Date.now,
    async checkpoint(options = {}) {
      if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
      if (options.completedToolCall) {
        await writeRun(live, { completedToolCalls: live.record.completedToolCalls + 1 });
      }
      if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
      if (!live.pauseRequested) return;

      const waiter = deferred();
      live.pauseWaiter = waiter;
      await options.beforePause?.();
      if (!live.pauseRequested) {
        live.pauseWaiter = null;
        await options.afterResume?.();
        if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
        return;
      }

      await writeRun(live, { state: 'paused' });
      await waiter.promise;
      live.pauseWaiter = null;
      if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
      await options.afterResume?.();
      if (controller.signal.aborted) throw controller.signal.reason || new Error('AGENT_CANCELLED');
      await writeRun(live, { state: 'running', error: undefined });
    },
  };

  // A managed execution owns an independent signal so closing the initiating
  // HTTP connection only detaches the caller; it does not cancel the task.
  const managedInput: AgentHttpInput = { body: input.body, signal: controller.signal };
  void Promise.resolve().then(() => invoke(managedInput, execution)).then(collectOutput).then(async (result) => {
    const terminal = controller.signal.aborted ? 'cancelled' : 'succeeded';
    await writeRun(live, { state: terminal, result, error: undefined });
  }).catch(async (error: unknown) => {
    const cancelled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const failureMessage = safeFailureMessage(error);
    await writeRun(live, {
      state: cancelled ? 'cancelled' : 'failed',
      ...(failureMessage ? { error: failureMessage } : { error: undefined }),
    });
  }).finally(() => {
    liveRuns.delete(id);
    live.pauseWaiter?.resolve();
  });

  return replyOf(live.record);
}

/** Missing and differently owned runs both return null. */
export async function readAgentAssistantRun(
  owner: string,
  runIdValue: string,
): Promise<AgentAssistantRunActionOutcome> {
  const runId = normalizedRunId(runIdValue);
  if (!runId || !owner.trim()) return null;
  return observeRecord(owner, runId);
}

/** Action retries are idempotent and return the latest durable run snapshot. */
export async function controlAgentAssistantRun(
  owner: string,
  runIdValue: string,
  action: AgentAssistantRunAction,
): Promise<AgentAssistantRunActionOutcome> {
  const runId = normalizedRunId(runIdValue);
  if (!runId || !owner.trim()) return null;
  const found = await findOwnedRecord(owner, runId);
  if (!found) return null;
  const live = liveRuns.get(found.id);
  let record = live?.record || found.record;
  if (isActive(record.state) && (!live || record.instanceId !== INSTANCE_ID)) {
    return replyOf(await markInterrupted(record));
  }
  if (!live || !isActive(record.state)) return replyOf(record);

  if (action === 'pause') {
    if (record.state === 'running') {
      live.pauseRequested = true;
      record = await writeRun(live, { state: 'pausing' }) || live.record;
    }
  } else if (action === 'resume') {
    if (record.state === 'paused' || record.state === 'pausing') {
      live.pauseRequested = false;
      if (record.state === 'paused') record = await writeRun(live, { state: 'running' }) || live.record;
      live.pauseWaiter?.resolve();
    }
  } else if (action === 'cancel') {
    if (record.state !== 'cancelling') {
      record = await writeRun(live, { state: 'cancelling' }) || live.record;
      live.pauseRequested = false;
      live.controller.abort(new Error('AGENT_CANCELLED'));
      live.pauseWaiter?.resolve();
    }
  }
  return replyOf(live.record || record);
}

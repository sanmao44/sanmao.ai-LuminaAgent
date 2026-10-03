import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadRuntime() {
  const source = await readFile(new URL('../packages/agent-core/runtime.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { AgentRuntime } = await loadRuntime();

function dependencies(overrides = {}) {
  return {
    model: {
      descriptor: { id: 'test-model', displayName: 'Test model', capabilities: { text: true, reasoning: false, toolUse: false, structuredOutput: false } },
      provider: { invoke: async () => ({ content: 'hello', modelId: 'test-model' }) },
      invoke: async (request) => ({ content: 'hello', modelId: request.runId }),
    },
    context: { build: (request) => request.messages },
    policy: { decide: () => ({ allowed: true }) },
    now: (() => { let value = 1000; return () => value++; })(),
    ...overrides,
  };
}

test('AgentRuntime executes a model through ports and emits lifecycle events', async () => {
  const runtime = new AgentRuntime(dependencies());
  const result = await runtime.run({ runId: 'run-1', model: dependencies().model.descriptor, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.output, 'hello');
  assert.equal(result.run.state, 'completed');
  assert.deepEqual(result.events.map((event) => event.type), [
    'AgentRunStarted', 'ModelInvocationStarted', 'ModelInvocationCompleted', 'AgentRunCompleted',
  ]);
});

test('AgentRuntime rejects policy before invoking the model', async () => {
  let invoked = false;
  await assert.rejects(
    () => new AgentRuntime(dependencies({
      model: { ...dependencies().model, invoke: async () => { invoked = true; return { content: 'no' }; } },
      policy: { decide: () => ({ allowed: false, reason: 'blocked' }) },
    })).run({ runId: 'run-2', model: dependencies().model.descriptor, messages: [] }),
    /blocked/,
  );
  assert.equal(invoked, false);
});

test('AgentRuntime marks aborted model calls as cancelled', async () => {
  const controller = new AbortController();
  const runtime = new AgentRuntime(dependencies({
    model: {
      ...dependencies().model,
      invoke: async () => { controller.abort(); throw new Error('cancelled'); },
    },
  }));
  await assert.rejects(() => runtime.run({ runId: 'run-3', model: dependencies().model.descriptor, messages: [], signal: controller.signal }), /cancelled/);
});

test('AgentRuntime emits provider-neutral structured telemetry without user content', async () => {
  const events = [];
  const runtime = new AgentRuntime(dependencies({ observer: { emit: (event) => events.push(event) } }));
  await runtime.run({ runId: 'run-observe', model: dependencies().model.descriptor, messages: [{ role: 'user', content: 'secret prompt' }] });
  assert.deepEqual(events.map((event) => event.phase), ['started', 'completed']);
  assert.equal(events[0].kind, 'agent');
  assert.equal(events[1].operationId, 'run-observe');
  assert.equal('content' in events[1], false);
});

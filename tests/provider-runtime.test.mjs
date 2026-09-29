import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/provider-runtime/chat.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createLegacyChatModelRuntime } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('legacy chat adapter normalizes provider responses behind the model contract', async () => {
  const calls = [];
  const runtime = createLegacyChatModelRuntime({
    descriptor: { id: 'registry-model', displayName: 'Registry model', capabilities: { text: true, reasoning: false, toolUse: false, structuredOutput: false } },
    invoke: async (messages, signal) => {
      calls.push({ messages, signal });
      return { model: 'upstream-model', choices: [{ message: { content: [{ text: ' hello ' }, { content: 'world' }] } }] };
    },
  });
  const controller = new AbortController();
  const result = await runtime.invoke({ runId: 'run-1', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal });
  assert.equal(result.content, 'hello\nworld');
  assert.equal(result.modelId, 'upstream-model');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content, 'hi');
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(runtime.descriptor.capabilities.text, true);
});

test('legacy chat adapter preserves empty and malformed provider responses as empty content', async () => {
  const runtime = createLegacyChatModelRuntime({
    descriptor: { id: 'model', displayName: 'Model', capabilities: { text: true, reasoning: false, toolUse: false, structuredOutput: false } },
    invoke: async () => ({ choices: [{ message: { content: null } }] }),
  });
  assert.deepEqual(await runtime.invoke({ runId: 'run-2', messages: [] }), { content: '' });
});

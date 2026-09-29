import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

async function loadRuntime() {
  const source = await readFile(new URL('../packages/task-runtime/runtime.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace("from '../contracts'", "from '../contracts/task.ts'");
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { TaskRuntime } = await loadRuntime();

test('TaskRuntime normalizes legacy statuses and applies lifecycle policy', () => {
  const runtime = new TaskRuntime((status) => status === 'done' ? 'succeeded' : status);
  assert.equal(runtime.state('done'), 'succeeded');
  assert.equal(runtime.isActive('running'), true);
  assert.equal(runtime.isActive('done'), false);
  assert.equal(runtime.canCancel('queued'), true);
  assert.equal(runtime.canRetry('failed'), true);
  assert.equal(runtime.canRetry('done'), false);
  assert.equal(runtime.canTransition('running', 'succeeded'), true);
  assert.equal(runtime.canTransition('succeeded', 'running'), false);
});

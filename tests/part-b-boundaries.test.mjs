import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migrated API and worker boundaries are real entry points', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  const cloneRoute = await readFile(new URL('../app/api/clone/jobs/route.ts', import.meta.url), 'utf8');
  const apiEntry = await readFile(new URL('../apps/api/agent-entry.ts', import.meta.url), 'utf8');
  const workerEntry = await readFile(new URL('../apps/worker/task-entry.ts', import.meta.url), 'utf8');
  assert.match(route, /runPlainAgentTurn/);
  assert.match(route, /createLegacyChatModelRuntime/);
  assert.match(cloneRoute, /dispatchCloneJob/);
  assert.match(apiEntry, /new AgentRuntime/);
  assert.match(workerEntry, /analyzeCloneJob/);
});

test('provider and task runtime observers expose bounded identity only', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  const taskService = await readFile(new URL('../lib/video-task-service.ts', import.meta.url), 'utf8');
  assert.match(route, /kind: 'provider'/);
  assert.match(taskService, /kind: 'task'/);
  assert.doesNotMatch(route, /providerOperationId[\s\S]{0,300}(prompt|arguments|content)/i);
});

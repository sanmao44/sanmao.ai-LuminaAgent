import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-agent-assistant-runs-'));
const previousDataDir = process.env.SANMAO_DATA_DIR;
process.env.SANMAO_DATA_DIR = dataDir;
const requireTs = createTsRequire(process.cwd());
const { startAgentAssistantRun, readAgentAssistantRun, controlAgentAssistantRun } = requireTs('./apps/api/agent-assistant-runs');
const owner = 'local-desktop-session';

async function waitForRun(runId, state, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await readAgentAssistantRun(owner, runId);
    if (reply?.run?.state === state) return reply;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const latest = await readAgentAssistantRun(owner, runId);
  assert.equal(latest?.run?.state, state, `expected ${state}; latest: ${JSON.stringify(latest?.run)}`);
  return latest;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test.after(async () => {
  if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
  else process.env.SANMAO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

test('managed assistant run pauses at the next tool boundary and resumes its existing work exactly once', async () => {
  const firstCallStarted = deferred();
  const allowFirstCallToFinish = deferred();
  const secondCallStarted = deferred();
  let firstCalls = 0;
  let secondCalls = 0;
  const runId = 'assistant-pause-resume-01';

  const started = await startAgentAssistantRun(
    { body: { messages: [{ role: 'user', content: 'Read both configured test files and report their actual contents.' }] }, signal: new AbortController().signal },
    runId,
    owner,
    async (_input, execution) => {
      await execution.checkpoint();
      firstCalls += 1;
      firstCallStarted.resolve();
      await allowFirstCallToFinish.promise;
      await execution.checkpoint({ completedToolCall: true });

      await execution.checkpoint();
      secondCalls += 1;
      secondCallStarted.resolve();
      await execution.checkpoint({ completedToolCall: true });
      return { kind: 'json', body: { ok: true, message: 'Both reads completed.', evidence: ['first actual read', 'second actual read'] } };
    },
  );

  assert.equal(started?.run?.state, 'running');
  await firstCallStarted.promise;
  const pausing = await controlAgentAssistantRun(owner, runId, 'pause');
  assert.equal(pausing?.run?.state, 'pausing');
  assert.equal(await controlAgentAssistantRun('other-session', runId, 'cancel'), null, 'another local session must not control this task');
  assert.equal(secondCalls, 0);

  allowFirstCallToFinish.resolve();
  const paused = await waitForRun(runId, 'paused');
  assert.equal(paused.run.completedToolCalls, 1);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);

  assert.equal((await controlAgentAssistantRun(owner, runId, 'resume'))?.run?.state, 'running');
  assert.equal((await controlAgentAssistantRun(owner, runId, 'resume'))?.run?.state, 'running', 'repeated resume must be idempotent');
  await secondCallStarted.promise;
  const completed = await waitForRun(runId, 'succeeded');
  assert.deepEqual(completed.result, { ok: true, message: 'Both reads completed.', evidence: ['first actual read', 'second actual read'] });
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test('cancelling a paused assistant task prevents the next tool call', async () => {
  const firstCallStarted = deferred();
  const allowFirstCallToFinish = deferred();
  let secondCalls = 0;
  const runId = 'assistant-pause-cancel-02';

  await startAgentAssistantRun(
    { body: { messages: [{ role: 'user', content: 'Do two read-only checks.' }] }, signal: new AbortController().signal },
    runId,
    owner,
    async (_input, execution) => {
      await execution.checkpoint();
      firstCallStarted.resolve();
      await allowFirstCallToFinish.promise;
      await execution.checkpoint({ completedToolCall: true });
      await execution.checkpoint();
      secondCalls += 1;
      return { kind: 'json', body: { ok: true } };
    },
  );

  await firstCallStarted.promise;
  assert.equal((await controlAgentAssistantRun(owner, runId, 'pause'))?.run?.state, 'pausing');
  allowFirstCallToFinish.resolve();
  await waitForRun(runId, 'paused');
  assert.equal((await controlAgentAssistantRun(owner, runId, 'cancel'))?.run?.state, 'cancelling');
  await waitForRun(runId, 'cancelled');
  assert.equal(secondCalls, 0);
});

// The browser client treats the initial POST as a launch, then attaches to the
// same run ID. Keep that wire behavior independent of component rendering.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const clientUrl = new URL('../lib/agent-client.ts', import.meta.url);
const clientSource = await readFile(clientUrl, 'utf8');
const clientCode = ts.transpileModule(clientSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: clientUrl.pathname,
}).outputText;
const agentClient = await import(`data:text/javascript;base64,${Buffer.from(clientCode).toString('base64')}`);

async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test('managed requests launch once and return the persisted task result', async () => {
  const calls = [];
  const runId = 'agent-client-managed-01';
  const response = await withFetch(async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === '/api/agent') return new Response(JSON.stringify({ runControl: {
      runId, state: 'running', completedToolCalls: 0, updatedAt: new Date().toISOString(),
    } }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ run: {
      runId, state: 'succeeded', completedToolCalls: 2, updatedAt: new Date().toISOString(),
    }, result: { ok: true, message: '来自实际任务的结果。' } }), { headers: { 'content-type': 'application/json' } });
  }, () => agentClient.requestAgent({
    managedRun: true,
    runId,
    source: 'canvas',
    executionMode: 'agent-dock',
    intentText: '检查两个实际文件',
    messages: [{ role: 'user', content: '检查两个实际文件' }],
  }));

  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET']);
  assert.equal(calls.filter(({ url }) => url === '/api/agent').length, 1, 'a status poll must not resubmit the task');
  const requestBody = JSON.parse(calls[0].body);
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.managedRun, true);
  assert.equal(requestBody.runId, runId);
  assert.deepEqual(response, { ok: true, message: '来自实际任务的结果。' });
});

test('a lost launch response reattaches to the run ID rather than starting it again', async () => {
  const methods = [];
  const runId = 'agent-client-reconnect-02';
  const response = await withFetch(async (input, options = {}) => {
    methods.push(options.method || 'GET');
    if (methods.length === 1) throw new TypeError('connection dropped after the launch was accepted');
    return new Response(JSON.stringify({ run: {
      runId, state: 'succeeded', completedToolCalls: 1, updatedAt: new Date().toISOString(),
    }, result: { ok: true, message: '同一轮任务完成。' } }), { headers: { 'content-type': 'application/json' } });
  }, () => agentClient.requestAgent({
    managedRun: true,
    runId,
    messages: [{ role: 'user', content: '读取并总结文件' }],
  }));
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.deepEqual(response, { ok: true, message: '同一轮任务完成。' });
});

test('pause and resume controls preserve the selected run ID and explicit action', async () => {
  let request;
  const runId = 'agent-client-control-03';
  await withFetch(async (input, options = {}) => {
    request = { url: String(input), method: options.method, body: options.body };
    return new Response(JSON.stringify({ run: {
      runId, state: 'paused', completedToolCalls: 1, updatedAt: new Date().toISOString(),
    } }), { headers: { 'content-type': 'application/json' } });
  }, async () => {
    const run = await agentClient.controlAssistantRun(runId, 'pause');
    assert.equal(run.state, 'paused');
  });
  assert.equal(request.url, `/api/agent/runs/${runId}/execution`);
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), { action: 'pause' });
});


const transportInvocations = [];
const transportRunState = { runId: '', owner: '', state: 'running', completedToolCalls: 0, updatedAt: new Date().toISOString() };
const transport = createTsRequire(process.cwd(), {
  '@/apps/api/agent-entrypoint': {
    runComposedAgentApplication: async (input) => {
      transportInvocations.push({ kind: 'invoke', input });
      return { kind: 'json', body: { ok: true, message: 'wrapped' } };
    },
    startAgentAssistantRun: async (input, runId, ownerHash, invoke) => {
      transportInvocations.push({ kind: 'start', input, runId, ownerHash, invoke });
      transportRunState.runId = runId;
      transportRunState.owner = ownerHash;
      return { run: { ...transportRunState } };
    },
    readAgentAssistantRun: async (ownerHash, runId) => {
      transportInvocations.push({ kind: 'read', ownerHash, runId });
      return ownerHash === transportRunState.owner && runId === transportRunState.runId
        ? { run: { ...transportRunState } }
        : null;
    },
    controlAgentAssistantRun: async (ownerHash, runId, action) => {
      transportInvocations.push({ kind: 'control', ownerHash, runId, action });
      if (ownerHash !== transportRunState.owner || runId !== transportRunState.runId) return null;
      transportRunState.state = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled';
      transportRunState.updatedAt = new Date().toISOString();
      return { run: { ...transportRunState } };
    },
  },
  '@/lib/agent/progress': {
    normalizeAgentRunId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null; },
  },
  '@/apps/api/agent-http-contract': {
    async readAgentHttpInput(request) { return { body: await request.json(), signal: request.signal }; },
  },
})('./apps/api/agent-transport');

function trustedRequest(url, { method = 'GET', body, cookie = 'admin=test', origin } = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(origin ? { origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('HTTP launch exposes an owned run; polling and controls address that run without resubmitting its prompt', async () => {
  transportInvocations.length = 0;
  const runId = 'assistant-http-control-04';
  const launched = await transport.handleAgentHttpRequest(trustedRequest('http://127.0.0.1:3210/api/agent', {
    method: 'POST', body: { managedRun: true, runId, messages: [{ role: 'user', content: 'Run the requested task' }] },
  }));
  assert.equal(launched.status, 202);
  assert.equal((await launched.json()).run.runId, runId);
  assert.deepEqual(transportInvocations.filter((item) => item.kind === 'start').map((item) => item.runId), [runId]);
  assert.equal(transportInvocations.filter((item) => item.kind === 'invoke').length, 0, 'launch request is scheduled, not run twice by the transport');

  const status = await transport.handleAgentAssistantRunExecutionRequest(
    trustedRequest(`http://127.0.0.1:3210/api/agent/runs/${runId}/execution`), runId,
  );
  assert.equal(status.status, 200);
  assert.equal((await status.json()).run.state, 'running');

  const paused = await transport.handleAgentAssistantRunExecutionRequest(trustedRequest(
    `http://127.0.0.1:3210/api/agent/runs/${runId}/execution`, { method: 'POST', body: { action: 'pause' } },
  ), runId);
  assert.equal((await paused.json()).run.state, 'paused');
  assert.deepEqual(transportInvocations.filter((item) => item.kind === 'control').map((item) => item.action), ['pause']);
  assert.equal(transportInvocations.filter((item) => item.kind === 'invoke').length, 0, 'pause controls the existing run; it never replays the user message');
});

test('managed-run transport rejects foreign browser origins and binds status to the original browser session', async () => {
  transportInvocations.length = 0;
  const runId = 'assistant-http-owner-05';
  const cookie = 'admin=one-session';
  const launched = await transport.handleAgentHttpRequest(trustedRequest('http://127.0.0.1:3210/api/agent', {
    method: 'POST', cookie,
    body: { managedRun: true, runId, messages: [{ role: 'user', content: 'Private user prompt' }] },
  }));
  assert.equal(launched.status, 202);

  const foreign = await transport.handleAgentAssistantRunExecutionRequest(trustedRequest(
    `http://127.0.0.1:3210/api/agent/runs/${runId}/execution`, { cookie: 'admin=another-session' },
  ), runId);
  assert.equal(foreign.status, 404);

  const crossSite = await transport.handleAgentAssistantRunExecutionRequest(trustedRequest(
    `http://127.0.0.1:3210/api/agent/runs/${runId}/execution`, { origin: 'https://attacker.example' },
  ), runId);
  assert.equal(crossSite.status, 401);
  assert.equal(transportInvocations.filter((item) => item.kind === 'read').length, 1, 'foreign sessions do not reach the run reader');
});


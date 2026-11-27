import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function pending(directory) {
  return {
    callId: 'project-typecheck-call',
    name: 'project_typecheck',
    toolId: 'native:project-typecheck',
    serverId: 'native:project-typecheck',
    serverName: '本地项目检查',
    toolName: 'TypeScript typecheck',
    readOnly: true,
    risk: 'read',
    reason: 'fixture',
    args: {},
    projectTypecheck: { directory },
  };
}

function createHarness(t, options = {}) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'sanmao-project-typecheck-resume-'));
  const oldDataDir = process.env.SANMAO_DATA_DIR;
  process.env.SANMAO_DATA_DIR = path.join(temporaryRoot, 'data');
  t.after(() => {
    if (oldDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = oldDataDir;
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const directory = path.join(temporaryRoot, 'workspace', 'project');
  const alternateDirectory = path.join(temporaryRoot, 'workspace', 'replacement');
  const state = {
    modelCalls: 0,
    mcpCalls: 0,
    runCalls: [],
    audit: [],
    canonicalDirectory: options.canonicalDirectory || directory,
    authorizedRoots: [path.dirname(directory)],
  };
  const projectTypecheck = {
    listAuthorizedRoots: () => state.authorizedRoots,
    validateDirectory: () => state.canonicalDirectory === directory
      ? { ok: true, directory }
      : { ok: true, directory: state.canonicalDirectory },
    run: async (input, runOptions = {}) => {
      state.runCalls.push({ input, signal: runOptions.signal });
      return options.result || {
        directory: input.directory,
        exitCode: 2,
        stdout: 'TS2322: fixture stdout',
        stderr: 'fixture stderr',
        durationMs: 17,
        timedOut: false,
        cancelled: false,
        outputTruncated: false,
      };
    },
  };
  const loadTs = createTsRequire(process.cwd(), {
    '@/lib/agent/project-typecheck': { createProjectTypecheckPort: () => projectTypecheck },
    '@/lib/providers': {
      chatCompletion: async () => {
        state.modelCalls += 1;
        throw new Error('project typecheck resume must not call the model');
      },
    },
    '@/lib/store': {
      getRuntimeModel: async () => {
        state.modelCalls += 1;
        throw new Error('project typecheck resume must not resolve a model');
      },
    },
    '@/lib/mcp/client': {
      MCP_TOOL_MAX_CALLS_PER_TURN: 8,
      MCP_TURN_TIME_BUDGET_MS: 60_000,
      callMcpTool: async () => {
        state.mcpCalls += 1;
        throw new Error('project typecheck resume must not call MCP');
      },
    },
    '@/lib/mcp/catalog-remote': { noteRemoteCatalogCallFailure() {}, noteRemoteCatalogCallSuccess() {} },
    '@/lib/mcp/store': { listMcpServers: () => [] },
    '@/lib/mcp/tools': { lazyMcpGroupKeywords: () => ({}), loadMcpToolRuntime: async () => ({ servers: [], tools: [] }) },
    '@/lib/tools/selector': { selectToolsForTurn: () => [] },
    '@/lib/tools/policy': { resolveToolPolicy: () => ({ allowed: false, tool: null }) },
    '@/lib/mcp/audit': { recordMcpCall: (entry) => state.audit.push(entry) },
    '@/lib/tabbit-cli': { isTabbitCliAvailable: () => false },
    '@/lib/tools': { tabbitBrowserTool: null },
  });
  const approval = loadTs('./lib/agent/approval');
  const { resumeAgentRun } = loadTs('./lib/agent/resume');
  return { approval, resumeAgentRun, directory, alternateDirectory, state, dataDir: process.env.SANMAO_DATA_DIR };
}

function createApproval(harness, directory = harness.directory) {
  return harness.approval.createApproval({
    provider: 'fixture',
    model: 'fixture-model',
    messages: [{ role: 'user', content: '运行 typecheck' }],
    assistant: { content: null, tool_calls: [] },
    executed: [],
    pending: [pending(directory)],
    gating: {},
  }, { dataDir: harness.dataDir });
}

test('approved project typecheck runs once, returns separated diagnostics, and never calls model or MCP', async (t) => {
  const harness = createHarness(t);
  const record = createApproval(harness);
  const result = await harness.resumeAgentRun({ id: record.id, action: 'approve', allowLocalProjectTypecheck: true });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.projectTypecheckResult.exitCode, 2);
  assert.equal(result.body.projectTypecheckResult.stdout, 'TS2322: fixture stdout');
  assert.equal(result.body.projectTypecheckResult.stderr, 'fixture stderr');
  assert.match(result.body.message, /真实退出码：2/);
  assert.match(result.body.message, /stdout:\nTS2322: fixture stdout/);
  assert.match(result.body.message, /stderr:\nfixture stderr/);
  assert.equal(harness.state.runCalls.length, 1);
  assert.equal(harness.state.modelCalls, 0);
  assert.equal(harness.state.mcpCalls, 0);
  assert.match(harness.state.audit[0].summary, new RegExp(`approvalId=${record.id}`));
  assert.doesNotMatch(harness.state.audit[0].summary, /TS2322|fixture stderr/);

  const replay = await harness.resumeAgentRun({ id: record.id, action: 'approve', allowLocalProjectTypecheck: true });
  assert.equal(replay.status, 404);
  assert.equal(harness.state.runCalls.length, 1);
});

test('project typecheck rejects without explicit local capability authorization', async (t) => {
  const harness = createHarness(t);
  const record = createApproval(harness);
  const result = await harness.resumeAgentRun({ id: record.id, action: 'approve' });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.match(result.body.projectTypecheckResult.error, /没有获得本地项目检查执行授权/);
  assert.equal(harness.state.runCalls.length, 0);
  assert.equal(harness.state.modelCalls, 0);
  assert.equal(harness.state.mcpCalls, 0);
});

test('rejecting project typecheck records a truthful non-execution result', async (t) => {
  const harness = createHarness(t);
  const record = createApproval(harness);
  const result = await harness.resumeAgentRun({ id: record.id, action: 'reject' });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.rejected, true);
  assert.match(result.body.message, /没有执行/);
  assert.match(result.body.projectTypecheckResult.error, /用户拒绝/);
  assert.equal(harness.state.runCalls.length, 0);
  assert.equal(harness.state.modelCalls, 0);
  assert.equal(harness.state.mcpCalls, 0);
});

test('project typecheck refuses a changed canonical directory after approval', async (t) => {
  const harness = createHarness(t);
  const record = createApproval(harness);
  harness.state.canonicalDirectory = harness.alternateDirectory;
  const result = await harness.resumeAgentRun({ id: record.id, action: 'approve', allowLocalProjectTypecheck: true });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.match(result.body.projectTypecheckResult.error, /等待确认期间发生变化/);
  assert.equal(harness.state.runCalls.length, 0);
  assert.equal(harness.state.modelCalls, 0);
  assert.equal(harness.state.mcpCalls, 0);
});

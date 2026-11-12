import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loadTs = createTsRequire(process.cwd());
const desktopInstructionPolicy = loadTs('./packages/agent-core/desktop-instruction-policy');
const browserFreshness = loadTs('./lib/agent/browser-freshness');

const SERVER_ID = 'windows-mcp';
const SERVER_NAME = 'Windows MCP';

function mcpTool(toolName, readOnly, serverConfig = {}) {
  const serverId = serverConfig.id || SERVER_ID;
  const serverName = serverConfig.name || SERVER_NAME;
  const name = `${serverId}__${toolName}`;
  const mcp = { serverId, serverName, toolName, readOnly, blocked: false };
  return {
    id: `mcp:${serverId}:${toolName}`,
    name,
    description: toolName,
    schema: { type: 'object', properties: {} },
    permissions: readOnly ? ['network'] : ['network', 'external:write'],
    tags: ['mcp'],
    source: 'mcp',
    risk: readOnly ? 'read' : 'external_side_effect',
    gating: () => true,
    mcp,
  };
}

function pendingCall(tool) {
  return {
    callId: `call-${tool.mcp.toolName}`,
    name: tool.name,
    toolId: tool.id,
    serverId: tool.mcp.serverId,
    serverName: tool.mcp.serverName,
    toolName: tool.mcp.toolName,
    readOnly: tool.mcp.readOnly,
    risk: tool.risk,
    reason: 'User approval required',
    args: tool.pendingArgs || { text: 'example' },
  };
}

function createResumeHarness({ instruction, pendingTools, availableTools = pendingTools, continuationCall = null, continuationReplies = [], servers: extraServers = [], failedTools = [] }) {
  const state = {
    audit: [],
    executeCalls: [],
    mcpCalls: [],
    modelCalls: [],
    runLoopCalls: 0,
    continuationPrompts: [],
  };
  const server = { id: SERVER_ID, catalogId: SERVER_ID, name: SERVER_NAME };
  const servers = [server, ...extraServers];
  const record = {
    id: 'approval-test',
    provider: 'test-provider',
    model: 'test-model',
    messages: [{ role: 'user', content: instruction }],
    assistant: { content: null, tool_calls: [] },
    executed: [],
    pending: pendingTools.map(pendingCall),
    gating: {},
  };

  const overrides = {
    '@/lib/providers': {
      chatCompletion: async (_provider, _model, options) => {
        state.modelCalls.push(options);
        if (Array.isArray(options.tools)) {
          const modelStep = state.modelCalls.filter((call) => Array.isArray(call.tools)).length - 1;
          const scripted = continuationReplies[modelStep];
          if (scripted?.toolCall) return { choices: [{ message: { content: null, tool_calls: [scripted.toolCall] } }] };
          if (scripted && typeof scripted.text === 'string') return { choices: [{ message: { content: scripted.text } }] };
          return {
            choices: [{ message: {
              content: null,
              tool_calls: continuationCall ? [continuationCall] : [],
            } }],
          };
        }
        return { choices: [{ message: { content: '已完成审批后的结果核验' } }] };
      },
    },
    '@/lib/store': {
      getRuntimeModel: async () => ({ provider: 'test-provider', model: { rawId: 'test-model' } }),
    },
    '@/lib/mcp/client': {
      MCP_TOOL_MAX_CALLS_PER_TURN: 8,
      MCP_TURN_TIME_BUDGET_MS: 60_000,
      callMcpTool: async () => {
        state.mcpCalls.push('called');
        return { content: 'MCP result' };
      },
    },
    '@/lib/mcp/catalog-remote': {
      noteRemoteCatalogCallFailure: () => {},
      noteRemoteCatalogCallSuccess: () => {},
    },
    '@/lib/mcp/tools': {
      lazyMcpGroupKeywords: () => ({}),
      loadMcpToolRuntime: async () => ({ servers, tools: availableTools }),
    },
    '@/packages/tool-runtime/tool-loop': {
      runToolLoop: async (options) => {
        state.runLoopCalls += 1;
        let toolCallCount = 0;
        for (let step = 0; step < options.maxSteps; step += 1) {
          const reply = await options.callModel({ step, messages: options.messages });
          const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
          if (calls.length) {
            await options.runCalls(calls, { step });
            toolCallCount += calls.length;
            continue;
          }
          const text = options.finalText(reply);
          const continuation = text
            ? options.continueOnText?.({ step, reply, text, messages: options.messages })
            : options.continueOnEmpty?.({ step, reply, messages: options.messages });
          if (continuation) {
            state.continuationPrompts.push(continuation);
            options.messages.push({ role: 'user', content: continuation });
            continue;
          }
          return { steps: step + 1, toolCallCount, text, stopReason: 'no_tool_calls', trace: [] };
        }
        return { steps: options.maxSteps, toolCallCount, text: '', stopReason: 'max_steps', trace: [] };
      },
    },
    '@/lib/tools/registry': {
      toModelToolSchema: (tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } }),
    },
    '@/lib/tools/selector': {
      selectToolsForTurn: ({ availableTools: tools }) => [...tools],
    },
    '@/lib/tools/policy': {
      resolveToolPolicy: (name, _context, tools) => {
        const tool = tools.find((candidate) => candidate.name === name);
        return { allowed: Boolean(tool && !tool.mcp?.blocked), reason: '', name: String(name || ''), source: tool?.source || null, permissions: tool?.permissions || [], tool: tool || null };
      },
    },
    '@/lib/agent/approval': {
      claimApproval: () => record,
      toolApprovalPolicy: () => 'ask',
    },
    '@/lib/mcp/filesystem-policy': { guardMcpServerCall: (_server, _toolName, args) => ({ ok: true, args }) },
    '@/lib/mcp/filesystem-roots': { listFilesystemRoots: () => [], listFilesystemWriteRoots: () => [] },
    '@/lib/mcp/audit': { recordMcpCall: (entry) => state.audit.push(entry) },
    '@/lib/data-paths': { resolveLocalDataDir: () => 'test-data' },
    '@/lib/skills': { stripToolCallMarkup: (text) => text },
    '@/lib/agent/filesystem-result': { verifyFilesystemMove: () => true },
    '@/lib/agent/tool-outcome': {
      toolOutcomeText: (text, outcomes) => JSON.stringify({ text, outcomes }),
    },
    '@/lib/agent/browser-freshness': browserFreshness,
    '@/lib/tabbit-cli': { isTabbitCliAvailable: () => false, runTabbitBrowserAction: async () => ({}) },
    '@/lib/tools': { tabbitBrowserTool: null },
    '@/packages/tool-runtime/mcp-executor': {
      executeMcpTool: async (input) => {
        state.executeCalls.push({ name: input.meta.toolName, args: input.args });
        if (failedTools.includes(input.meta.toolName)) {
          input.dependencies.onUsage({ meta: input.meta, ok: false });
          input.dependencies.onAudit({ meta: input.meta, allowed: true, ok: false, durationMs: 1, summary: 'timeout' });
          return { ok: false, message: { role: 'tool', tool_call_id: input.callId, content: JSON.stringify({ ok: false, error: 'timeout' }) } };
        }
        await input.dependencies.call();
        input.dependencies.onUsage({ meta: input.meta, ok: true });
        input.dependencies.onAudit({ meta: input.meta, allowed: true, ok: true, durationMs: 1, summary: 'success' });
        return { ok: true, message: { role: 'tool', tool_call_id: input.callId, content: JSON.stringify({ ok: true }) } };
      },
      executeTabbitTool: async (input) => {
        state.executeCalls.push({ name: 'tabbit_browser', args: input.args });
        const ok = !failedTools.includes('tabbit_browser');
        input.onUsage(ok);
        input.onAudit({ ok, durationMs: 1, summary: ok ? 'success' : 'timeout' });
        return { ok, message: { role: 'tool', tool_call_id: input.callId, content: JSON.stringify(ok ? { ok: true } : { ok: false, error: 'timeout' }) } };
      },
    },
    '@/packages/agent-core/desktop-instruction-policy': desktopInstructionPolicy,
  };

  const { resumeAgentRun } = createTsRequire(process.cwd(), overrides)('./lib/agent/resume');
  return { state, run: () => resumeAgentRun({ id: record.id, action: 'approve' }) };
}

test('approval resume blocks Windows input and screenshot calls forbidden by the saved instruction', async () => {
  const tools = [mcpTool('Type', false), mcpTool('Screenshot', true)];
  const harness = createResumeHarness({
    instruction: '不要输入任何内容，也不要截图。',
    pendingTools: tools,
  });

  const result = await harness.run();

  assert.equal(harness.state.executeCalls.length, 0);
  assert.equal(harness.state.mcpCalls.length, 0);
  assert.deepEqual(
    harness.state.audit.map(({ tool, decision, allowed }) => ({ tool, decision, allowed })),
    [
      { tool: 'Type', decision: 'block', allowed: false },
      { tool: 'Screenshot', decision: 'block', allowed: false },
    ],
  );
  assert.match(String(result.body.message), /禁止|拒绝|未执行/);
});

test('approved desktop write without an available observation cannot be reported complete', async () => {
  const click = mcpTool('Click', false);
  const harness = createResumeHarness({
    instruction: '请点击桌面上的开始按钮。',
    pendingTools: [click],
    continuationReplies: [{ text: 'Done, the button was clicked.' }],
  });

  const result = await harness.run();

  assert.equal(result.status, 200);
  assert.deepEqual(harness.state.executeCalls.map(({ name }) => name), ['Click']);
  assert.equal(harness.state.mcpCalls.length, 1);
  assert.equal(harness.state.audit.filter(({ decision }) => decision === 'approval').length, 1);
  assert.match(String(result.body.message), /尚无新的成功观察|未完成|尚未确认/);
  assert.doesNotMatch(String(result.body.message), /Done, the button was clicked/);
});

test('approved desktop write can finish only after a fresh Snapshot observation', async () => {
  const windows = { id: SERVER_ID, name: SERVER_NAME, catalogId: 'windows-mcp' };
  const click = mcpTool('Click', false);
  const snapshot = mcpTool('Snapshot', true);
  const snapshotCall = { id: 'desktop-snapshot', function: { name: snapshot.name, arguments: '{}' } };
  const harness = createResumeHarness({
    instruction: '请点击桌面上的开始按钮。',
    pendingTools: [click],
    availableTools: [click, snapshot],
    servers: [windows],
    continuationReplies: [
      { text: 'The click worked.' },
      { toolCall: snapshotCall },
      { text: 'The fresh desktop snapshot confirms the button is active.' },
    ],
  });

  const result = await harness.run();

  assert.deepEqual(harness.state.executeCalls.map(({ name }) => name), ['Click', 'Snapshot']);
  assert.match(String(result.body.message), /fresh desktop snapshot confirms/i);
  assert.ok(harness.state.continuationPrompts.some((prompt) => /桌面操作后尚无新的成功观察/.test(prompt)));
});

test('approved desktop write with a screenshot request requires Screenshot rather than Snapshot', async () => {
  const windows = { id: SERVER_ID, name: SERVER_NAME, catalogId: 'windows-mcp' };
  const click = mcpTool('Click', false);
  const snapshot = mcpTool('Snapshot', true);
  const screenshot = mcpTool('Screenshot', true);
  const screenshotCall = { id: 'desktop-screenshot', function: { name: screenshot.name, arguments: '{}' } };
  const harness = createResumeHarness({
    instruction: '请点击桌面上的开始按钮，然后截图核验。',
    pendingTools: [click],
    availableTools: [click, snapshot, screenshot],
    servers: [windows],
    continuationReplies: [
      { text: 'The click worked.' },
      { toolCall: screenshotCall },
      { text: 'The fresh screenshot confirms the button is active.' },
    ],
  });

  const result = await harness.run();

  assert.deepEqual(harness.state.executeCalls.map(({ name }) => name), ['Click', 'Screenshot']);
  assert.match(String(result.body.message), /fresh screenshot confirms/i);
  assert.ok(harness.state.continuationPrompts.some((prompt) => /尚无成功 Screenshot/.test(prompt)));
});

test('approved Playwright mutation must be followed by a fresh observation before completion', async () => {
  const playwright = { id: 'playwright', name: 'Playwright', catalogId: 'playwright' };
  const click = mcpTool('browser_click', false, playwright);
  const snapshot = mcpTool('browser_snapshot', true, playwright);
  const clickCall = { id: 'read-snapshot', function: { name: snapshot.name, arguments: '{}' } };
  const withoutObservation = createResumeHarness({
    instruction: 'Open the page and click Submit.',
    pendingTools: [click],
    availableTools: [click, snapshot],
    servers: [playwright],
    continuationReplies: [{ text: 'The click succeeded.' }],
  });

  const incomplete = await withoutObservation.run();
  assert.equal(withoutObservation.state.executeCalls.length, 1);
  assert.match(String(incomplete.body.message), /尚未确认/);
  assert.ok(withoutObservation.state.continuationPrompts.some((prompt) => /新的页面观察/.test(prompt)));

  const withObservation = createResumeHarness({
    instruction: 'Open the page and click Submit.',
    pendingTools: [click],
    availableTools: [click, snapshot],
    servers: [playwright],
    continuationReplies: [
      { text: 'The click succeeded.' },
      { toolCall: clickCall },
      { text: 'The new snapshot confirms it.' },
    ],
  });
  const confirmed = await withObservation.run();
  assert.deepEqual(withObservation.state.executeCalls.map(({ name }) => name), ['browser_click', 'browser_snapshot']);
  assert.match(String(confirmed.body.message), /new snapshot confirms/i);
});

test('a snapshot before an approved mutation is stale, and failed writes block later pending writes', async () => {
  const playwright = { id: 'playwright', name: 'Playwright', catalogId: 'playwright' };
  const snapshot = mcpTool('browser_snapshot', true, playwright);
  const click = mcpTool('browser_click', false, playwright);
  const stale = createResumeHarness({
    instruction: 'Open the page and click Submit.',
    pendingTools: [snapshot, click],
    availableTools: [snapshot, click],
    servers: [playwright],
    continuationReplies: [{ text: 'The operation is complete.' }],
  });
  const staleResult = await stale.run();
  assert.deepEqual(stale.state.executeCalls.map(({ name }) => name), ['browser_snapshot', 'browser_click']);
  assert.match(String(staleResult.body.message), /尚未确认/);

  const failedBatch = createResumeHarness({
    instruction: 'Click the button twice only if the first click has not happened.',
    pendingTools: [click, click],
    availableTools: [click, snapshot],
    servers: [playwright],
    failedTools: ['browser_click'],
    continuationReplies: [{ text: 'Done.' }],
  });
  await failedBatch.run();
  assert.deepEqual(failedBatch.state.executeCalls.map(({ name }) => name), ['browser_click']);
});

test('approved Tabbit writes require a read-only page observation before the resume can finish', async () => {
  const tabbitServer = { id: 'tabbit', name: 'Tabbit Browser', catalogId: 'tabbit' };
  const tabbit = mcpTool('browser', false, tabbitServer);
  tabbit.name = 'tabbit_browser';
  tabbit.pendingArgs = { action: 'nodejs', readOnly: false, code: 'await page.click("button")' };
  const readOnlyCall = { id: 'tabbit-observe', function: { name: tabbit.name, arguments: JSON.stringify({ action: 'nodejs', readOnly: true, code: 'return await page.locator("body").innerText()' }) } };
  const harness = createResumeHarness({
    instruction: 'Click the page button.',
    pendingTools: [tabbit],
    availableTools: [tabbit],
    servers: [tabbitServer],
    continuationReplies: [
      { text: 'The click succeeded.' },
      { toolCall: readOnlyCall },
      { text: 'The fresh page observation confirms the click.' },
    ],
  });

  const result = await harness.run();
  assert.deepEqual(harness.state.executeCalls.map(({ name }) => name), ['tabbit_browser', 'tabbit_browser']);
  assert.equal(harness.state.executeCalls[1].args.readOnly, true);
  assert.match(String(result.body.message), /fresh page observation confirms/i);

  const failedBatch = createResumeHarness({
    instruction: 'Click the page button.',
    pendingTools: [tabbit, tabbit],
    availableTools: [tabbit],
    servers: [tabbitServer],
    failedTools: ['tabbit_browser'],
    continuationReplies: [{ text: 'Done.' }],
  });
  await failedBatch.run();
  assert.equal(failedBatch.state.executeCalls.length, 1, 'a timed-out Tabbit write blocks the next pending write');
});

test('forbidden screenshot is omitted from continuation tools and blocked if the model still emits it', async () => {
  const snapshot = mcpTool('Snapshot', true);
  const screenshot = mcpTool('Screenshot', true);
  const harness = createResumeHarness({
    instruction: '请查看桌面状态，但不要截图。',
    pendingTools: [snapshot],
    availableTools: [snapshot, screenshot],
    continuationCall: { id: 'model-screenshot', function: { name: screenshot.name, arguments: '{}' } },
  });

  const result = await harness.run();

  const continuationModelCall = harness.state.modelCalls.find((call) => Array.isArray(call.tools));
  assert.ok(continuationModelCall, '续读模型调用应携带工具列表');
  assert.deepEqual(continuationModelCall.tools.map((tool) => tool.function.name), [snapshot.name]);
  assert.deepEqual(harness.state.executeCalls.map(({ name }) => name), ['Snapshot']);
  assert.equal(harness.state.mcpCalls.length, 1);
  assert.ok(harness.state.audit.some(({ tool, decision, allowed }) => tool === 'Screenshot' && decision === 'block' && allowed === false));
  assert.equal(result.status, 200);
});

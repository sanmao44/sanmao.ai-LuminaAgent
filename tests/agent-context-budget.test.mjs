import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextBudgetModule } from './tools-build.mjs';

const budget = await buildContextBudgetModule();

test('context budget keeps assistant tool calls paired with their results', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'read' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'large result' },
    { role: 'user', content: 'new' },
  ];
  const bounded = budget.boundAgentContext(messages, 500);
  const assistantIndex = bounded.findIndex((message) => message.role === 'assistant');
  assert.ok(assistantIndex >= 0);
  assert.equal(bounded[assistantIndex + 1]?.role, 'tool');
  assert.equal(bounded[assistantIndex + 1]?.tool_call_id, 'call-1');

  const smaller = budget.boundAgentContext(messages, 24);
  assert.deepEqual(smaller, [messages[0], messages.at(-1)]);
});

test('old tool arguments count toward the text budget and are dropped with their results', () => {
  const argumentsText = JSON.stringify({ files: [{ filename: 'page.html', content: '<p>' + 'x'.repeat(1000) + '</p>' }] });
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'html', function: { name: 'file_generate', arguments: argumentsText } }] },
    { role: 'tool', tool_call_id: 'html', content: 'saved' },
    { role: 'user', content: 'continue' },
  ];
  const bounded = budget.boundAgentContext(messages, 100);
  assert.deepEqual(bounded, [messages[0], messages.at(-1)]);
  assert.equal(messages[2].tool_calls[0].function.arguments, argumentsText);
  assert.deepEqual(JSON.parse(argumentsText).files[0].filename, 'page.html');
});

test('reasoning fields count toward the text budget without being partially rewritten', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: 'answer', reasoning_content: 'reasoning'.repeat(200) },
    { role: 'user', content: 'new' },
  ];
  assert.deepEqual(budget.boundAgentContext(messages, 100), [messages[0], messages[2]]);
  assert.equal(messages[1].reasoning_content.length, 1800);
});

test('byte budget removes a large old media message while retaining the current request', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: [
      { type: 'text', text: 'old reference' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(10000) } },
      { type: 'video_url', video_url: { url: 'https://example.test/' + 'v'.repeat(10000) } },
    ] },
    { role: 'assistant', content: 'understood' },
    { role: 'user', content: '生成 HTML 页面' },
  ];
  const bounded = budget.boundAgentContext(messages, 100, { maxBytes: 1000 });
  assert.deepEqual(bounded, [messages[0], messages[2], messages[3]]);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(messages), 'utf8') > 20000);
});

test('the default wire budget removes a 5 MiB historical image instead of charging a constant placeholder', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024) } }] },
    { role: 'user', content: '生成 HTML' },
  ];
  const bounded = budget.boundAgentContext(messages, 16000);
  assert.deepEqual(bounded, [messages[0], messages[2]]);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 16000 * 4);
});

test('the default history wire budget reserves the current turn multi-MiB media intact', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'O'.repeat(1024 * 1024) } }] },
    { role: 'user', content: [
      { type: 'text', text: '根据本轮附件生成 HTML' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'N'.repeat(3 * 1024 * 1024) } },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,' + 'V'.repeat(2 * 1024 * 1024) } },
    ] },
  ];
  const bounded = budget.boundAgentContext(messages, 16000);
  assert.deepEqual(bounded, [messages[0], messages[2]]);
  assert.equal(bounded[1].content[1].image_url.url, messages[2].content[1].image_url.url);
  assert.equal(bounded[1].content[2].video_url.url, messages[2].content[2].video_url.url);
});

test('Unicode byte weighting accounts for non-ASCII history within an explicit wire budget', () => {
  const makeMessages = (oldText) => [
    { role: 'system', content: 'system' },
    { role: 'user', content: oldText },
    { role: 'user', content: '生成 HTML' },
  ];
  const ascii = makeMessages('a'.repeat(100));
  const chinese = makeMessages('中'.repeat(100));
  const maxBytes = Buffer.byteLength(JSON.stringify(ascii), 'utf8');
  assert.deepEqual(budget.boundAgentContext(ascii, 1000, { maxBytes }), ascii);
  assert.deepEqual(budget.boundAgentContext(chinese, 1000, { maxBytes }), [chinese[0], chinese[2]]);
});

test('the default text budget weights Chinese history more conservatively than equal-length ASCII', () => {
  const makeMessages = (oldText) => [
    { role: 'system', content: 'system' },
    { role: 'user', content: oldText },
    { role: 'user', content: '生成 HTML' },
  ];
  const ascii = makeMessages('a'.repeat(100));
  const chinese = makeMessages('中'.repeat(100));
  assert.deepEqual(budget.boundAgentContext(ascii, 200), ascii);
  assert.deepEqual(budget.boundAgentContext(chinese, 200), [chinese[0], chinese[2]]);
});

test('tool argument JSON, reasoning and call identifiers use the same UTF-8 text weighting', () => {
  const toolMessages = (text) => [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call', function: { name: 'read', arguments: JSON.stringify({ text }) } }] },
    { role: 'tool', tool_call_id: 'call', content: 'result' },
  ];
  assert.doesNotThrow(() => budget.boundAgentContext(toolMessages('a'.repeat(100)), 250));
  assert.throws(() => budget.boundAgentContext(toolMessages('中'.repeat(100)), 250), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });

  const reasoningMessages = (text) => [{ role: 'user', content: 'task' }, { role: 'assistant', content: null, reasoning_content: text }];
  assert.doesNotThrow(() => budget.boundAgentContext(reasoningMessages('a'.repeat(100)), 250));
  assert.throws(() => budget.boundAgentContext(reasoningMessages('中'.repeat(100)), 250), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });

  const identifiedMessages = (id) => [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [{ id, function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, content: 'result' },
  ];
  assert.doesNotThrow(() => budget.boundAgentContext(identifiedMessages('a'.repeat(100)), 500));
  assert.throws(() => budget.boundAgentContext(identifiedMessages('中'.repeat(100)), 500), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
});

test('a current attachment that exceeds the byte budget fails explicitly and remains intact', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: [
      { type: 'text', text: '按附件生成 HTML' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(5000) } },
    ] },
  ];
  const original = structuredClone(messages);
  assert.throws(() => budget.boundAgentContext(messages, 100, { maxBytes: 1000 }), (error) => {
    assert.equal(error.code, 'AGENT_CONTEXT_BUDGET_EXCEEDED');
    assert.equal(error.requiredBytes, Buffer.byteLength(JSON.stringify(messages), 'utf8'));
    assert.match(error.message, /本轮指令、附件及工具结果/);
    return true;
  });
  assert.deepEqual(messages, original);
});

test('system content cannot silently crowd out or truncate the latest user instruction', () => {
  const messages = [{ role: 'system', content: 'x'.repeat(100) }, { role: 'user', content: 'generate HTML' }];
  assert.throws(() => budget.boundAgentContext(messages, 100), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
  assert.equal(messages[1].content, 'generate HTML');
});

test('all current-turn tool calls and results stay intact when old history is removed', () => {
  const currentTurn = [
    { role: 'user', content: '生成 HTML' },
    { role: 'assistant', content: null, reasoning_content: '先读资料', tool_calls: [{ id: 'read-1', function: { name: 'read', arguments: '{"path":"brief.txt"}' } }] },
    { role: 'tool', tool_call_id: 'read-1', content: 'brief' },
    { role: 'assistant', content: null, reasoning_content: '生成文件', tool_calls: [{ id: 'file-1', function: { name: 'file_generate', arguments: '{"files":[{"filename":"a.html","content":"<p>你好</p>"}]}' } }] },
    { role: 'tool', tool_call_id: 'file-1', content: 'saved' },
  ];
  const system = { role: 'system', content: 'system' };
  const messages = [system, { role: 'user', content: 'old'.repeat(1000) }, ...currentTurn];
  const bounded = budget.boundAgentContext(messages, 500);
  assert.deepEqual(bounded, [system, ...currentTurn]);
  assert.equal(bounded[2].tool_calls[0].function.arguments, currentTurn[1].tool_calls[0].function.arguments);
});

test('an explicit current turn boundary preserves the real request across internal user-role recovery prompts', () => {
  const system = { role: 'system', content: 'system' };
  const currentTurn = [
    { role: 'user', content: '按附件要求生成 HTML：' + '产品需求'.repeat(30) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'read', function: { name: 'read', arguments: '{"path":"brief.txt"}' } }] },
    { role: 'tool', tool_call_id: 'read', content: 'brief requirements' },
    { role: 'user', content: '内部恢复提示：请继续调用文件工具。' },
  ];
  const messages = [system, { role: 'user', content: 'old'.repeat(1000) }, ...currentTurn];
  assert.deepEqual(budget.boundAgentContext(messages, 1000, { currentTurnStart: 2 }), [system, ...currentTurn]);
  assert.throws(() => budget.boundAgentContext(messages, 200, { currentTurnStart: 2 }), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
  const defaultBounded = budget.boundAgentContext(messages, 200);
  assert.equal(defaultBounded.includes(currentTurn[0]), false, 'default detection cannot identify an internally appended user message');
  assert.ok(defaultBounded.includes(currentTurn.at(-1)));
});

test('an explicit turn boundary inside a tool unit still preserves the whole call/result pair', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: 'old'.repeat(1000) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'read', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read', content: 'result' },
    { role: 'user', content: 'retry' },
  ];
  assert.deepEqual(budget.boundAgentContext(messages, 200, { currentTurnStart: 3 }), [messages[0], messages[2], messages[3], messages[4]]);
});

test('only valid explicit turn indices override latest-user detection, including index zero', () => {
  const messages = [{ role: 'user', content: 'old'.repeat(100) }, { role: 'user', content: 'new' }];
  for (const currentTurnStart of [-1, 0.5, messages.length, NaN, Infinity]) {
    assert.deepEqual(budget.boundAgentContext(messages, 100, { currentTurnStart }), [messages[1]]);
  }
  assert.throws(() => budget.boundAgentContext(messages, 100, { currentTurnStart: 0 }), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
});

test('required tool arguments cannot be shortened into invalid JSON to fit the budget', () => {
  const argumentsText = JSON.stringify({ content: 'x'.repeat(1000) });
  const messages = [
    { role: 'user', content: '生成 HTML' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'file', function: { name: 'file_generate', arguments: argumentsText } }] },
    { role: 'tool', tool_call_id: 'file', content: 'saved' },
  ];
  assert.throws(() => budget.boundAgentContext(messages, 100), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
  assert.equal(messages[1].tool_calls[0].function.arguments, argumentsText);
});

test('UTF-8 request size includes every field and external request overhead', () => {
  const messages = [
    { role: 'system', content: '系统' },
    { role: 'user', content: '你好😀\n' },
    { role: 'assistant', content: null, reasoning_content: '思考', tool_calls: [{ id: '调用', function: { name: 'read', arguments: '{"path":"中文.txt"}' } }] },
    { role: 'tool', tool_call_id: '调用', content: '结果' },
  ];
  const messageBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  const tools = [{ type: 'function', function: { name: 'read', description: '读取资料' } }];
  const overheadBytes = Buffer.byteLength(JSON.stringify({ model: 'model', messages: [], tools }), 'utf8') - 2;
  assert.equal(budget.agentContextSerializedBytes(messages), messageBytes);
  assert.deepEqual(budget.boundAgentContext(messages, 1000, { maxBytes: messageBytes + overheadBytes, overheadBytes }), messages);
  assert.throws(() => budget.boundAgentContext(messages, 1000, { maxBytes: messageBytes + overheadBytes - 1, overheadBytes }), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
});

test('tool definition text can reserve budget before selecting optional history', () => {
  const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'old'.repeat(20) }, { role: 'user', content: 'new' }];
  assert.deepEqual(budget.boundAgentContext(messages, 100, { overheadChars: 80 }), [messages[0], messages[2]]);
  assert.throws(() => budget.boundAgentContext(messages, 100, { overheadChars: 95 }), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
});

test('a synthesis request without a user keeps its latest complete tool unit', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: 'old'.repeat(1000) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call', content: 'result' },
  ];
  assert.deepEqual(budget.boundAgentContext(messages, 200), [messages[0], messages[2], messages[3]]);
});

test('a trailing system instruction keeps its position without replacing the latest content unit', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: 'old'.repeat(1000) },
    { role: 'assistant', content: 'current' },
    { role: 'system', content: 'persona' },
  ];
  assert.deepEqual(budget.boundAgentContext(messages, 100), [messages[0], messages[2], messages[3]]);
});

test('model budget reserves output and remains conservative', () => {
  assert.equal(budget.modelInputCharBudget(32768, undefined, 4096), 86016);
  assert.equal(budget.modelInputCharBudget(4096, 2048, 1024), 16000, 'the legacy minimum remains unchanged for compatibility');
  assert.ok(budget.modelInputCharBudget(undefined, undefined, undefined) <= 600000);
});

test('chat payload budgets are recalculated per model without mutating the source history', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old'.repeat(10_000) },
    { role: 'user', content: 'current request' },
  ];
  const payload = { messages, tool_choice: 'none' };
  assert.deepEqual(budget.boundAgentChatPayload(payload, { rawId: 'large', contextWindow: 32_768 }).messages, messages);
  assert.deepEqual(budget.boundAgentChatPayload(payload, { rawId: 'small', contextWindow: 8_192 }).messages, [messages[0], messages[2]]);
  assert.equal(payload.messages, messages);
  assert.equal(messages.length, 3);
});

test('chat payload budgets include tool schemas and preserve the real turn before retry hints', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old'.repeat(5_000) },
    { role: 'user', content: 'current request' },
    { role: 'user', content: 'internal retry hint' },
  ];
  const payload = { messages, tools: [{ type: 'function', function: { name: 'read', description: 's'.repeat(4_000) } }], tool_choice: 'auto' };
  const bounded = budget.boundAgentChatPayload(payload, { rawId: 'small', contextWindow: 8_192 }, { currentTurnStart: 2 });
  assert.deepEqual(bounded.messages, [messages[0], messages[2], messages[3]]);
  assert.equal(bounded.tools, payload.tools);
  assert.equal(bounded.tool_choice, 'auto');
  assert.throws(() => budget.boundAgentChatPayload({ messages: messages.slice(2), tools: [{ description: 'x'.repeat(16_000) }] }, { rawId: 'small', contextWindow: 8_192 }, { currentTurnStart: 0 }), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
});

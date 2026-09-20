import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolLoopModule } from './tools-build.mjs';

const loop = await buildToolLoopModule();

function toolCall(name, id = name) {
  return { id, function: { name, arguments: '{}' } };
}

function modelReturning(...replies) {
  let index = 0;
  return async () => replies[Math.min(index++, replies.length - 1)];
}

function recorder() {
  const executed = [];
  const runCalls = async (calls, context) => {
    executed.push(...calls.map((call) => `${context.step}:${call.function.name}`));
    return calls.map((call) => ({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) }));
  };
  return { executed, runCalls };
}

test('模型不再要工具就立刻结束，文本原样交回', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning({ content: '直接回答，不需要工具', tool_calls: [] }),
    runCalls,
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '直接回答，不需要工具');
  assert.equal(outcome.steps, 1);
  assert.equal(outcome.toolCallCount, 0);
  assert.deepEqual(executed, []);
  assert.deepEqual(messages, [], '没有工具调用就不要往消息里塞东西');
});

test('多轮：执行工具 → 把结果带回去 → 再问一次，消息顺序正确', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning(
      { content: null, tool_calls: [toolCall('skill_search', 'a')] },
      { content: '读完了，这是结论' },
    ),
    runCalls,
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '读完了，这是结论');
  assert.equal(outcome.toolCallCount, 1);
  assert.deepEqual(executed, ['0:skill_search']);
  assert.equal(messages.length, 2, '助手消息 + 工具结果');
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].tool_calls[0].id, 'a');
  assert.equal(messages[1].role, 'tool');
  assert.equal(messages[1].tool_call_id, 'a');
});

test('连续任务空回复后继续规划，直到工具执行并得到最终回答', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  let continuationPrompts = 0;
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning(
      { content: '', tool_calls: [] },
      { content: null, tool_calls: [toolCall('browser_snapshot', 'snapshot')] },
      { content: '已完成全部操作', tool_calls: [] },
    ),
    runCalls,
    continueOnEmpty: () => {
      if (continuationPrompts >= 1) return false;
      continuationPrompts += 1;
      return '请继续核对尚未完成的操作';
    },
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '已完成全部操作');
  assert.equal(outcome.steps, 3);
  assert.equal(outcome.toolCallCount, 1);
  assert.deepEqual(executed, ['1:browser_snapshot']);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '请继续核对尚未完成的操作');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[2].role, 'tool');
});

test('连续任务明确说尚未完成时继续规划，而不是把中间状态当成最终回答', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  let prompts = 0;
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning(
      { content: '评论区仍在加载，暂时无法提交', tool_calls: [] },
      { content: null, tool_calls: [toolCall('browser_snapshot', 'retry')] },
      { content: '已完成全部操作', tool_calls: [] },
    ),
    runCalls,
    continueOnText: ({ text }) => {
      if (prompts >= 1 || !/暂时无法提交/.test(text)) return false;
      prompts += 1;
      return '请继续核对并完成剩余操作';
    },
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '已完成全部操作');
  assert.equal(outcome.steps, 3);
  assert.deepEqual(executed, ['1:browser_snapshot']);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '请继续核对并完成剩余操作');
});

test('思维链模型要求的 reasoning_content 跟着助手消息一起带回去', async () => {
  const messages = [];
  const { runCalls } = recorder();
  await loop.runToolLoop({
    messages,
    callModel: modelReturning(
      { content: null, tool_calls: [toolCall('skill_read')], reasoning_content: '先查一下' },
      { content: '好了' },
    ),
    runCalls,
  });
  assert.equal(messages[0].reasoning_content, '先查一下');
});

test('模型一直要工具时，最多跑到 maxSteps 就停', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    maxSteps: 3,
    callModel: modelReturning({ content: null, tool_calls: [toolCall('skill_read')] }),
    runCalls,
  });
  assert.equal(outcome.stopReason, 'max_steps');
  assert.equal(outcome.steps, 3);
  assert.equal(outcome.toolCallCount, 3);
  assert.equal(executed.length, 3);
});

test('一轮放不下时整轮不执行，也不留下没有结果的 tool_calls', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    maxCalls: 2,
    callModel: modelReturning({ content: null, tool_calls: [toolCall('a'), toolCall('b'), toolCall('c')] }),
    runCalls,
  });
  assert.equal(outcome.stopReason, 'max_calls');
  assert.deepEqual(executed, [], '宁可少答一轮，也不执行半截');
  assert.deepEqual(messages, [], '消息里不能出现没有工具结果的 tool_calls');
});

test('shouldContinue 返回 false 时停下，并把这一步标成不再继续', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning({ content: null, tool_calls: [toolCall('skill_read')] }),
    runCalls,
    shouldContinue: ({ toolCallCount }) => toolCallCount < 1,
  });
  assert.equal(outcome.stopReason, 'stopped');
  assert.equal(outcome.steps, 1);
  assert.equal(executed.length, 1, '这一步的工具还是要执行的');
  assert.equal(outcome.trace[0].continued, false);
});

test('超过总时长就不再开新一轮', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  let clock = 0;
  const outcome = await loop.runToolLoop({
    messages,
    deadlineMs: 1000,
    now: () => clock,
    callModel: async () => {
      clock += 2000;
      return { content: null, tool_calls: [toolCall('skill_read')] };
    },
    runCalls,
  });
  assert.equal(outcome.stopReason, 'deadline');
  assert.equal(outcome.steps, 1);
  assert.equal(executed.length, 0, '模型返回时已超时，不再执行新的副作用');
});

test('已经中止就不再调用模型', async () => {
  const messages = [];
  const controller = new AbortController();
  controller.abort();
  let modelCalls = 0;
  const outcome = await loop.runToolLoop({
    messages,
    signal: controller.signal,
    callModel: async () => {
      modelCalls += 1;
      return { content: '不该走到这里' };
    },
    runCalls: recorder().runCalls,
  });
  assert.equal(outcome.stopReason, 'signal');
  assert.equal(modelCalls, 0);
});

test('orderCalls 决定执行顺序，archive_generate 排到最后', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  await loop.runToolLoop({
    messages,
    callModel: modelReturning(
      { content: null, tool_calls: [toolCall('archive_generate'), toolCall('document_generate')] },
      { content: '打包好了' },
    ),
    orderCalls: (calls) => [...calls].sort((left, right) => Number(left.function.name === 'archive_generate') - Number(right.function.name === 'archive_generate')),
    runCalls,
  });
  assert.deepEqual(executed, ['0:document_generate', '0:archive_generate']);
  assert.deepEqual(messages[0].tool_calls.map((call) => call.function.name), ['archive_generate', 'document_generate'], '写回消息的仍是模型原本的顺序');
});

test('Trace 记下每一轮的调用与耗时，收尾轮也记一笔', async () => {
  const messages = [];
  const { runCalls } = recorder();
  let clock = 0;
  const outcome = await loop.runToolLoop({
    messages,
    now: () => (clock += 5),
    callModel: modelReturning(
      { content: null, tool_calls: [toolCall('skill_search')] },
      { content: '结论' },
    ),
    runCalls,
  });
  assert.equal(outcome.trace.length, 2);
  assert.deepEqual(outcome.trace[0].calls, ['skill_search']);
  assert.equal(outcome.trace[0].continued, true);
  assert.deepEqual(outcome.trace[1].calls, []);
  assert.equal(outcome.trace[1].continued, false);
  assert.ok(outcome.trace.every((step) => step.durationMs >= 0));
});

test('没有名字的调用不算工具调用，也不写进消息', async () => {
  const messages = [];
  const { executed, runCalls } = recorder();
  const outcome = await loop.runToolLoop({
    messages,
    callModel: modelReturning({ content: '直接答', tool_calls: [{ id: 'x', function: {} }] }),
    runCalls,
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '直接答');
  assert.deepEqual(executed, []);
  assert.deepEqual(messages, [], '没有名字的 tool_calls 不能写回，否则服务商侧会直接报错');
});

test('模型调用失败（返回 null）时当作没有工具调用，不抛异常', async () => {
  const messages = [];
  const outcome = await loop.runToolLoop({
    messages,
    callModel: async () => null,
    runCalls: recorder().runCalls,
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.text, '');
  assert.deepEqual(messages, []);
});

test('默认上限是保守值，避免工具循环失控', () => {
  assert.equal(loop.TOOL_LOOP_DEFAULT_MAX_STEPS, 4);
  assert.equal(loop.TOOL_LOOP_DEFAULT_MAX_CALLS, 12);
  assert.equal(loop.TOOL_LOOP_DEFAULT_DEADLINE_MS, 180_000);
});

test('调用指纹：同 server + 同工具 + 同参数才算同一个，参数键序不影响', () => {
  const a = loop.mcpCallSignature('playwright', 'browser_click', { element: '提交', index: 1 });
  assert.equal(a, loop.mcpCallSignature('playwright', 'browser_click', { index: 1, element: '提交' }), '键序不同是同一个调用');
  assert.notEqual(a, loop.mcpCallSignature('playwright', 'browser_click', { element: '删除', index: 1 }));
  assert.notEqual(a, loop.mcpCallSignature('playwright', 'browser_snapshot', { element: '提交', index: 1 }));
  assert.notEqual(a, loop.mcpCallSignature('filesystem', 'browser_click', { element: '提交', index: 1 }));
  assert.equal(loop.mcpCallSignature(undefined, undefined, undefined), loop.mcpCallSignature('', '', {}));
});

test('连续三次同参数同结果才算卡住，结果一变就重新计数', () => {
  assert.equal(loop.TOOL_LOOP_MCP_REPEAT_LIMIT, 3);
  const tracker = new Map();
  const key = loop.mcpCallSignature('playwright', 'browser_click', { element: '提交' });
  assert.equal(loop.trackMcpRepeat(tracker, key, '页面没变'), 1);
  assert.equal(loop.trackMcpRepeat(tracker, key, '页面没变'), 2);
  assert.equal(loop.trackMcpRepeat(tracker, key, '页面没变'), 3, '第三次就是该停下的信号');
  assert.equal(loop.trackMcpRepeat(tracker, key, '页面变了'), 1, '结果变了就是有新信息，重新计数');
  assert.equal(loop.trackMcpRepeat(tracker, loop.mcpCallSignature('playwright', 'browser_snapshot', {}), '页面没变'), 1, '换工具单独计数');
});

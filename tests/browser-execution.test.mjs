import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMcpModule, buildToolLoopModule } from './tools-build.mjs';

const { BROWSER_EXECUTION_LIMITS: limits, browserTextSubmissionGap: gap, browserExternalBlocker } = await buildMcpModule();
const { runToolLoop } = await buildToolLoopModule();
const instruction = '打开bilibili，搜索AE实用技巧，给第一个视频点赞，并回复“不错！不错！”';
const use = (name, args = {}, result = '', ok = true) => ({ name, args, result, ok });
const input = use('browser_type', { text: '不错！不错！', element: '评论框' });
const submit = use('browser_click', { element: '发送评论' });
const verified = use('browser_snapshot', {}, '### Snapshot\n- paragraph: 不错！不错！');

test('搜索输入、点击结果和快照不能冒充评论完成；支持中文/英文单引号', () => {
  const search = [use('browser_type', { text: 'AE实用技巧' }), use('browser_click'), verified];
  assert.equal(gap(instruction, search), 'input');
  assert.equal(gap("回复'不错！不错！'", search), 'input');
  assert.equal(gap('回复‘不错！不错！’', search), 'input');
  assert.equal(gap('查看评论内容', []), '');
  assert.equal(gap(instruction, [input, use('browser_click', { element: '点赞' }), verified]), 'submit');
});

test('提交后必须有页面证据；输入框里的文本、工具代码和空快照均不算成功', () => {
  for (const result of ['', '### Ran Playwright code\n不错！不错！', '### Snapshot\n- generic [ref=e1174]: 不错！不错！', '### Snapshot\n- textbox "评论": 不错！不错！', '### Snapshot\n- textbox "评论":\n  - text: 不错！不错！']) {
    assert.equal(gap(instruction, [input, submit, use('browser_snapshot', {}, result)]), 'verify');
  }
  assert.equal(gap(instruction, [input, submit, verified]), '');
  assert.equal(gap(instruction, [input, verified, submit, verified]), 'verify', '既有同文评论不能证明本次发表成功');
  assert.equal(gap(instruction, [input, submit, use('browser_snapshot', {}, '### Snapshot\n- status: 评论成功')]), '');
});

test('发送超时需要先核验，不能直接重发；支持回车与表单输入', () => {
  const failed = { ...submit, ok: false };
  assert.equal(gap(instruction, [input, failed]), 'verify');
  assert.equal(gap(instruction, [input, failed, verified]), '');
  assert.equal(gap(instruction, [use('browser_type', { text: '不错！不错！', submit: true }), verified]), '');
  assert.equal(gap(instruction, [use('browser_fill_form', { fields: [{ value: '不错！不错！' }] }), use('browser_press_key', { key: 'Control+Enter' }), verified]), '');
});

test('登录和验证码阻塞必须来自最新页面证据，普通登录入口不算阻塞', () => {
  assert.equal(browserExternalBlocker([use('browser_snapshot', {}, 'button 登录')]), '');
  assert.equal(browserExternalBlocker([use('browser_snapshot', {}, '请先登录')]), '页面要求先登录');
  assert.equal(browserExternalBlocker([use('browser_snapshot', {}, '请完成安全验证')]), '页面要求完成人机验证');
  assert.equal(browserExternalBlocker([use('browser_snapshot', {}, '请先登录'), verified]), '');
});

test('慢模型完整执行打开、搜索、点击恢复、点赞、输入、发送和验证，超过三分钟与12轮仍能继续', async () => {
  const script = [
    use('browser_navigate'), use('browser_snapshot'), use('browser_navigate'), use('browser_snapshot'),
    use('browser_click', {}, 'Timeout', false), use('browser_snapshot'), use('browser_navigate'), use('browser_snapshot'),
    use('browser_wait_for'), use('browser_snapshot'), use('browser_click', { element: '点赞' }),
    use('browser_snapshot'), input, use('browser_snapshot'), submit, verified,
  ];
  const uses = [];
  let clock = 0;
  let emptyCallbacks = 0;
  const outcome = await runToolLoop({
    messages: [], maxSteps: limits.maxSteps, maxCalls: limits.maxCalls, deadlineMs: limits.deadlineMs, now: () => clock,
    callModel: async ({ step }) => {
      clock += 21_000;
      const current = script[step];
      return current ? { tool_calls: [{ id: String(step), function: { name: current.name, arguments: JSON.stringify(current.args) } }] } : { content: '点赞和评论已完成' };
    },
    runCalls: async (calls, { step }) => {
      uses.push(script[step]);
      return calls.map(call => ({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(script[step]) }));
    },
    continueOnEmpty: () => { emptyCallbacks++; return '继续'; },
    continueOnText: () => gap(instruction, uses) ? '继续剩余操作' : false,
  });
  assert.equal(outcome.stopReason, 'no_tool_calls');
  assert.equal(outcome.toolCallCount, script.length);
  assert.ok(clock > 180_000);
  assert.equal(emptyCallbacks, 0, '正常完成文本不能消耗空回复恢复预算');
  assert.equal(gap(instruction, uses), '');
  assert.equal(uses.filter(u => u.name === 'browser_type').length, 1);
  assert.equal(uses.filter(u => u.args.element === '发送评论').length, 1);
});

test('恢复后用尽轮数不能返回旧的中间回复，也不能误报正常结束', async () => {
  const outcome = await runToolLoop({
    messages: [], maxSteps: 2,
    callModel: async () => ({ content: '尚未完成' }),
    runCalls: async () => [], continueOnText: () => '继续',
  });
  assert.equal(outcome.stopReason, 'max_steps');
  assert.equal(outcome.text, '');
});

test('浏览器总时限仍有效，超时后不执行模型刚生成的提交动作', async () => {
  let clock = 0;
  let executions = 0;
  const outcome = await runToolLoop({
    messages: [], deadlineMs: limits.deadlineMs, now: () => clock,
    callModel: async () => { clock = limits.deadlineMs + 1; return { tool_calls: [{ function: { name: 'browser_click' } }] }; },
    runCalls: async () => { executions++; return []; },
  });
  assert.equal(outcome.stopReason, 'deadline');
  assert.equal(executions, 0);
});

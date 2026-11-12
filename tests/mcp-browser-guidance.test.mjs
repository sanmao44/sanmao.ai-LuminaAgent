import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserGuidanceModule, buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const { TABBIT_BROWSER_TOOL_GUIDE } = await buildBrowserGuidanceModule();

test('Tabbit comment completion separates fill from submit and treats unclassified writes as uncertain', () => {
  const instruction = 'Reply "requested phrase"';
  const expected = 'requested phrase';
  const use = (readOnly, result, ok = true) => ({
    name: 'tabbit_browser', ok, args: { action: 'nodejs', readOnly },
    result: typeof result === 'string' ? result : JSON.stringify(result),
  });
  const write = use(false, { result: 'script completed' });
  const baseline = use(true, { comments: [{ text: 'an older comment' }] });
  const prepare = { ...use(false, { result: 'prepared' }), args: { action: 'nodejs', readOnly: false, commentStage: 'prepare' } };
  const fill = { ...use(false, { result: 'filled' }), args: { action: 'nodejs', readOnly: false, commentStage: 'fill' } };
  const submit = { ...use(false, { result: 'clicked' }), args: { action: 'nodejs', readOnly: false, commentStage: 'submit' } };

  assert.equal(mcp.browserTextSubmissionGap(instruction, []), 'input');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [write]), 'verify', 'a write without an observation may have submitted');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write]), 'verify', 'script completion text is not proof');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, '')]), 'verify', 'empty results do not verify');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, { result: 'done' })]), 'verify', 'unrelated output does not verify');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, { textareaValue: expected })]), 'verify', 'unclassified writes never infer that a draft is ready to send');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, prepare, use(true, { comments: [{ text: expected }] })]), '', 'a mislabeled prepare write cannot hide a newly published comment');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, prepare, use(true, { comments: [], composerValue: '' })]), 'input', 'a verified prepare without the target comment can continue to fill');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, fill]), 'verify', 'a fill stage must be observed before proceeding');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, fill, use(true, { comments: [{ text: 'an older comment' }], composerValue: expected })]), 'submit', 'fresh editor evidence advances a fill to submit');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, fill, use(true, { comments: [], composerValue: 'different draft' })]), 'input', 'observed editor text that differs from the request returns to fill');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, submit, use(true, { comments: [{ text: 'an older comment' }], composerValue: expected })]), 'verify', 'a submit attempt is never repeated based on a still-filled composer');
  const playwrightSubmit = { name: 'browser_click', ok: true, args: { element: '发送评论' } };
  const playwrightBaseline = { name: 'browser_snapshot', ok: true, result: '### Snapshot\n- paragraph: older comment' };
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, playwrightBaseline, fill, use(true, { comments: [], composerValue: expected }), playwrightSubmit]), 'verify', 'a later Playwright submission prevents a duplicate Tabbit submit');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, playwrightBaseline, fill, use(true, { comments: [], composerValue: expected }), playwrightSubmit, {
    name: 'browser_snapshot', ok: true, result: '### Snapshot\n- paragraph: requested phrase',
  }]), '', 'a Playwright snapshot can verify the cross-backend submit');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, { comments: [{ text: 'an older comment' }] })]), 'verify', 'unclassified writes do not infer whether the comment was filled or sent');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, JSON.stringify(JSON.stringify({ replies: [{ text: expected }] })))]), '', 'nested JSON reply-list content verifies');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, { successMessage: 'Comment successfully posted' })]), '', 'an explicit success message verifies');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, write, use(true, { comments: [{ text: expected }] })]), '', 'a new matching comment verifies');

  const oldComment = use(true, { comments: [{ text: expected }] });
  assert.equal(mcp.browserTextSubmissionGap(instruction, [oldComment, write, oldComment]), 'verify', 'a comment already present before submission is stale evidence');
  const oldSuccess = use(true, { successMessage: 'Comment successfully posted' });
  assert.equal(mcp.browserTextSubmissionGap(instruction, [oldSuccess, write, oldSuccess]), 'verify', 'a success signal already present before submission is stale evidence');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [write, use(true, { comments: [{ text: expected }] })]), 'verify', 'without a baseline, a matching old comment is ambiguous');
  const failedWrite = use(false, { error: 'execution timed out' }, false);
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, failedWrite]), 'verify', 'failed writes still require observation');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, { ...failedWrite, args: { ...failedWrite.args, commentStage: 'submit' } }, use(true, { comments: [{ text: expected }] })]), '', 'fresh evidence resolves a failed submit');
});

test('Tabbit guide describes comment verification result fields', () => {
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /commentStage.*prepare.*fill.*submit/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /composerValue.*comments\/replies/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /不确定时只观察，不重复发送/);
});

test('Tabbit read-only page evidence can identify external login and verification blockers', () => {
  const use = (text) => ({
    name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: true },
    result: JSON.stringify({ pageText: text }),
  });
  assert.match(mcp.browserExternalBlocker([use('Please log in to comment')]), /登录/);
  assert.match(mcp.browserExternalBlocker([use('Verify you are human')]), /人机验证/);
  assert.equal(mcp.browserExternalBlocker([
    use('Please log in to comment'),
    { name: 'browser_click', ok: false, args: { element: 'Comment' } },
  ]), '', 'stale blocker observations cannot end a task after a later mutation');
  assert.match(mcp.browserExternalBlocker([
    { name: 'browser_click', ok: false, args: { element: 'Comment' } },
    use('Please log in to comment'),
  ]), /登录/, 'a fresh blocker observation still ends automated retries');
});

test('元素定位写错时要给出能照着改的中文纠错', () => {
  // 全部是本机真实踩到的报错原文（上游 Playwright MCP 只说英文，模型看不懂就换个选择器再试）。
  const misused = [
    'Error: browserBackend.callTool: Unknown engine "ref" while parsing selector ref=f4e6',
    'Error: "input#app-search-int i.search-input" does not match any elements.',
    'Error: "generic [ref=f5e14]" does not match any elements.',
    'Error: browserBackend.callTool: Unexpected token "" while parsing css selector "". Did you mean to CSS.escape it?',
    'Error: Ref f4e6 not found in the current page snapshot. Try capturing new snapshot.',
  ];
  for (const raw of misused) {
    const hint = mcp.browserTargetHint(raw);
    assert.ok(hint, `这类错要认出来：${raw}`);
    assert.match(hint, /target/, '要说清 ref 值该填在哪个参数里');
    assert.match(hint, /browser_snapshot/, '要说清先取快照');
  }
  // 不是定位参数的问题就不要乱加解释：扩展没连上、超时各有各的话术。
  assert.equal(mcp.browserTargetHint('Error: browser_click: element not found'), null);
  assert.equal(mcp.browserTargetHint('tools/call 超时（120 秒）'), null);
  assert.equal(mcp.browserTargetHint('Playwright Extension not found in "C:\\Users\\me\\AppData"'), null);
  assert.equal(mcp.browserTargetHint(''), null);
});

test('系统提示里的浏览器约定要写清 ref 的取法', () => {
  const guide = mcp.BROWSER_TOOL_GUIDE;
  assert.match(guide, /browser_snapshot/, '先取快照');
  assert.match(guide, /target/, 'ref 值填在 target 参数里');
  assert.match(guide, /ref=f5e14/, '把「连前缀一起抄」这个错法点名');
  assert.match(guide, /CSS 选择器/, '把「自己编选择器」这个错法点名');
  assert.match(guide, /重新/, '每次操作后 ref 会换，要重新取快照');
});

test('Tabbit 提示按 CLI 生命周期创建任务并为新程序生成独立 requestId', () => {
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /明确的新网址.*直接调用 nodejs/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /已有标签页时，先用 create/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /task 名称（允许空格）/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /diagnose 只检查运行状态，不创建 task/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /每个新的 nodejs 程序必须使用新的 requestId/);
  assert.match(TABBIT_BROWSER_TOOL_GUIDE, /Unknown task name.*先用 create/);
});

test('浏览器循环不会把“现在继续提交评论”当成最终回复', () => {
  assert.equal(mcp.browserTextNeedsContinuation('我已完成点赞，现在继续提交评论。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('评论区操作未能继续完成。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('已打开官网，接下来搜索退款流程。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('打开网站后，我现在访问帮助中心。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('已完成搜索，下一步下载报告。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('已完成全部操作，评论已出现在列表中。'), false);
  assert.equal(mcp.browserTextNeedsContinuation('我已经搜索、打开并下载报告，操作全部完成。'), false);
});

test('评论/回复必须按输入、发送、验证顺序完成', () => {
  const instruction = '打开网站后回复“不错！不错！”';
  const use = (name) => ({ name, ok: true, args: { text: '不错！不错！', element: '发送评论' }, result: '### Snapshot\n- paragraph: 不错！不错！' });
  const baseline = { name: 'browser_snapshot', ok: true, result: '### Snapshot\n- textbox "评论"\n- button "发送评论"' };
  assert.equal(mcp.browserTextSubmissionGap(instruction, []), 'input');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type')]), 'submit');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type'), use('browser_click')]), 'verify');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [baseline, use('browser_type'), use('browser_click'), use('browser_snapshot')]), '');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type'), use('browser_click'), use('browser_snapshot')]), 'verify', 'a post-submit snapshot without a pre-submit baseline is ambiguous');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [
    { name: 'browser_snapshot', ok: true, result: '### Snapshot\n- paragraph: 不错！不错！' },
    use('browser_type'), use('browser_click'),
    { name: 'browser_snapshot', ok: true, result: '### Snapshot\n- paragraph: 不错！不错！' },
  ]), 'verify', 'an unchanged old comment is not new publication evidence');
  assert.equal(mcp.browserTextSubmissionGap('请回复：这张图很棒', [{ ...use('browser_type'), args: { text: '这张图很棒' } }]), 'submit', 'unquoted text after a colon remains content-verifiable');
  assert.equal(mcp.browserTextSubmissionGap('回复“这是‘重点’内容”', [{ ...use('browser_type'), args: { text: '这是‘重点’内容' } }]), 'submit', 'paired nested quotes preserve the complete body');
  assert.equal(mcp.browserTextSubmissionGap('Reply "it\'s great"', [{ ...use('browser_type'), args: { text: "it's great" } }]), 'submit', 'an apostrophe inside an English quoted body is preserved');
  assert.equal(mcp.browserTextSubmissionGap('请回复一下', []), 'verify', 'comment intent without safely parsed text cannot bypass verification');
  assert.equal(mcp.browserTextSubmissionGap('查看评论区有什么内容', []), '');
});

test('评论流程提示必须包含输入、发送和结果核验', () => {
  const guide = mcp.BROWSER_TOOL_GUIDE;
  assert.match(guide, /browser_type/, '要明确使用输入工具');
  assert.match(guide, /browser_click/, '要明确点击发送');
  assert.match(guide, /成功提示|评论出现在列表/, '要明确核验提交结果');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();

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

test('浏览器循环不会把“现在继续提交评论”当成最终回复', () => {
  assert.equal(mcp.browserTextNeedsContinuation('我已完成点赞，现在继续提交评论。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('评论区操作未能继续完成。'), true);
  assert.equal(mcp.browserTextNeedsContinuation('已完成全部操作，评论已出现在列表中。'), false);
});

test('评论/回复必须按输入、发送、验证顺序完成', () => {
  const instruction = '打开网站后回复“不错！不错！”';
  const use = (name) => ({ name, ok: true, args: { text: '不错！不错！', element: '发送评论' }, result: '### Snapshot\n- paragraph: 不错！不错！' });
  assert.equal(mcp.browserTextSubmissionGap(instruction, []), 'input');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type')]), 'submit');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type'), use('browser_click')]), 'verify');
  assert.equal(mcp.browserTextSubmissionGap(instruction, [use('browser_type'), use('browser_click'), use('browser_snapshot')]), '');
  assert.equal(mcp.browserTextSubmissionGap('查看评论区有什么内容', []), '');
});

test('评论流程提示必须包含输入、发送和结果核验', () => {
  const guide = mcp.BROWSER_TOOL_GUIDE;
  assert.match(guide, /browser_type/, '要明确使用输入工具');
  assert.match(guide, /browser_click/, '要明确点击发送');
  assert.match(guide, /成功提示|评论出现在列表/, '要明确核验提交结果');
});

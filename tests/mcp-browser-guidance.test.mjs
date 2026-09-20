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
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');

const MCP_TOOL = { name: 'gh__search', tags: ['mcp'], source: 'mcp' };

test('执行类别由注册表标签推导，MCP 按来源归类', () => {
  assert.equal(tools.toolExecutionKind('web_search'), 'web');
  assert.equal(tools.toolExecutionKind('file_generate'), 'file');
  assert.equal(tools.toolExecutionKind('document_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('archive_generate'), 'artifact', 'archive_generate 复用交付物分支');
  assert.equal(tools.toolExecutionKind('image_edit'), 'image');
  assert.equal(tools.toolExecutionKind('skill_search'), 'skill');
  assert.equal(tools.toolExecutionKind('gh__search', [MCP_TOOL]), 'mcp');
  assert.equal(tools.toolExecutionKind('gh__search'), null, 'MCP 工具不在本轮列表里就查不到');
  assert.equal(tools.toolExecutionKind('not_a_tool'), null);
  assert.equal(tools.toolExecutionKind(''), null);
  assert.equal(tools.toolExecutionKind(undefined), null);
  assert.equal(tools.kindForTool({ tags: ['artifact', 'mcp'], source: 'mcp' }), 'mcp', '来源优先于标签');
  assert.equal(tools.kindForTool({ tags: [], source: 'native' }), null, '没有标签的工具没有执行类别');
});

test('route.ts 每个类别都有分支，且分派不看工具名', () => {
  for (const kind of ['web', 'file', 'artifact', 'skill', 'mcp']) {
    assert.ok(route.includes(`if (kind === '${kind}') {`), `${kind} 缺少执行分支`);
  }
  assert.ok(route.includes(`if (kind !== 'image') continue;`), 'image 分支也由类别决定');
  assert.ok(route.includes('const kind = toolExecutionKind(call?.function?.name, mcpTools);'), '类别要从注册表推导');
  assert.ok(route.indexOf('const policy = resolveToolPolicy(') < route.indexOf('const kind = toolExecutionKind('), '先过权限再分派');
});
/**
 * 下面三条行为原先由 tests/tools-executor.test.mjs 覆盖（backup-executor-task-runtime 分支）。
 * 统一执行点重构成 route.ts 内联分派时那条用例跟着删了，行为却还在，这里补回来防退化。
 */
test('取消时 abort 原样抛出，不被降级成工具错误', () => {
  // 按缩进切出每一个 catch 体：真正在 catch 里的降级都要先原样抛出取消。
  const lines = route.split(/\r?\n/);
  const catches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^(\s*)\}\s*catch\s*\(/.exec(lines[index]);
    if (!open) continue;
    const indent = open[1].length;
    const body = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const closing = lines[next].match(/^(\s*)\}/);
      if (closing && closing[1].length <= indent) break;
      body.push(lines[next]);
    }
    catches.push(body.join('\n'));
  }
  const degrading = catches.filter((body) => body.includes('toolResults.push('));
  assert.ok(degrading.length >= 5, `工具执行的降级兜底应有多个，当前 ${degrading.length} 处`);
  const rethrowMarker = 'signal.aborted) throw requestController.signal.reason';
  const skipped = degrading.filter((body) => !body.includes(rethrowMarker));
  // 唯一例外：待确认操作的存盘失败。它不执行任何工具，只把失败结果回给模型；
  // 取消会由下一轮上游请求的 abort 接管，所以这里不额外抛。
  assert.equal(skipped.length, 1, '除存盘失败外，每个降级 catch 都要先原样抛出取消');
  assert.ok(skipped[0].includes('待确认的操作没能保存下来'), '例外必须仍是那处存盘失败');
  for (const body of degrading) {
    if (body === skipped[0]) continue;
    const rethrow = body.indexOf(rethrowMarker);
    const push = body.indexOf('toolResults.push(');
    assert.ok(rethrow >= 0 && rethrow < push, '取消要原样抛出，不能降级成 tool 错误后继续跑');
  }
});

test('参数不是合法 JSON 时按空对象兜底，不打断整轮请求', () => {
  const lines = route.split(/\r?\n/);
  const parses = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((row) => row.line.includes('JSON.parse(call.function.arguments'));
  assert.ok(parses.length >= 3, '本轮、待确认与执行前三处都要兜底');
  for (const { line, index } of parses) {
    assert.ok(line.includes("|| '{}'"), '模型没给参数时要按空对象兜底');
    assert.ok(line.includes('catch {}'), '解析失败要吞掉错误，不能打断整轮请求');
    assert.ok(lines[index - 1].trim().endsWith('= {};'), 'catch 之后 args 必须仍是可用的空对象');
  }
});

test('未注册的工具名不会落到任何执行分支', () => {
  assert.equal(tools.toolExecutionKind('not_a_tool'), null);
  assert.equal(tools.toolExecutionKind('gh__search'), null, 'MCP 工具不在本轮列表里也不执行');
  // 分派只按类别相等判断，null 一个分支都不命中，最后靠这条兜底直接跳过。
  assert.ok(route.includes("if (kind !== 'image') continue;"), '缺兜底 continue：未知工具会掉进 image 分支');
  const branches = route.match(/if \(kind === '[a-z-]+'\) \{/g) || [];
  assert.ok(branches.length >= 5, '执行分支都是类别相等判断');
});
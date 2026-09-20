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
  assert.ok(route.includes(`if (kind !== 'image') return { results };`), 'image 分支也由类别决定');
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
  // executeToolCall 把结果先攒在本地 results 里，再由调用方写回历史；存盘失败改成把原因交回调用方。
  const pushIndex = (body) => {
    const indexes = [body.indexOf('toolResults.push('), body.indexOf('results.push(')].filter((index) => index >= 0);
    return indexes.length ? Math.min(...indexes) : -1;
  };
  const degrading = catches.filter((body) => pushIndex(body) >= 0);
  assert.ok(degrading.length >= 4, `工具执行的降级兜底应有多个，当前 ${degrading.length} 处`);
  const rethrowMarker = 'signal.aborted) throw requestController.signal.reason';
  for (const body of degrading) {
    const rethrow = body.indexOf(rethrowMarker);
    const push = pushIndex(body);
    assert.ok(rethrow >= 0 && rethrow < push, '取消要原样抛出，不能降级成 tool 错误后继续跑');
  }
  // 存盘失败是唯一不进上面的失败路径：它不执行任何工具，只把原因交回调用方，
  // 由调用方写回「没有执行」再继续收尾。
  const saveFailures = catches.filter((body) => body.includes('待确认的操作没能保存下来'));
  assert.equal(saveFailures.length, 1, '存盘失败的兜底只有一处');
  assert.ok(pushIndex(saveFailures[0]) < 0, '存盘失败不写任何工具结果，只把原因交回调用方');
  assert.ok(route.includes('if (saved.response) return saved.response;'), '存盘失败后仍要回一条「没有执行」并继续收尾');
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
  assert.ok(route.includes("if (kind !== 'image') return { results };"), '缺兜底：未知工具会掉进 image 分支');
  const branches = route.match(/if \(kind === '[a-z-]+'\) \{/g) || [];
  assert.ok(branches.length >= 5, '执行分支都是类别相等判断');
});

test('MCP 工具调用要再补一轮，且和首轮走同一个执行点', () => {
  // 只交一轮工具，模型拿到 browser_navigate 的结果后就没有工具可用了，只能把下一步写成 <tool_call> 文本。
  assert.ok(route.includes('MCP_TOOL_FOLLOWUP_MAX_ROUNDS = 6'), 'MCP 补轮要有独立轮数上限');
  assert.ok(route.includes('tools: mcpFollowupTools'), '补轮必须把 MCP 工具重新交给模型');
  const loopStart = route.indexOf('tools: mcpFollowupTools');
  assert.ok(route.indexOf("tool_choice: 'auto'", loopStart) > loopStart, '补轮要允许模型再要工具');
  assert.ok(route.includes('const run = await executeToolCall(calls[index], calls, index);'), '补轮复用同一个执行点，权限/审批/停滞检测才不会被绕开');
  const shouldContinue = route.indexOf('shouldContinue: () => !deferredCalls.length && mcpToolCallCount < mcpToolCallLimit');
  const finalText = route.indexOf('finalText: (reply) => stripToolCallMarkup', shouldContinue);
  const approval = route.indexOf('requestApproval({', shouldContinue);
  assert.ok(shouldContinue >= 0 && shouldContinue < finalText && finalText < approval, '补轮结构：先判上限，再截文本，最后才是确认卡片');
  assert.ok(approval < route.indexOf("reportProgress({ stage: 'answering'", shouldContinue), '补轮的确认卡片要在收尾之前挡下来');
});

test('浏览器连续任务拥有独立的恢复预算，空回复后会要求重新核对并继续', () => {
  assert.match(route, /const MCP_BROWSER_TOOL_FOLLOWUP_MAX_ROUNDS = 12/);
  assert.match(route, /const MCP_BROWSER_TOOL_MAX_CALLS_PER_TURN = 32/);
  assert.match(route, /const MCP_BROWSER_TURN_TIME_BUDGET_MS = 300_000/);
  assert.match(route, /const mcpTurnBudgetLimit = browserAutomationRequest \? MCP_BROWSER_TURN_TIME_BUDGET_MS/);
  assert.match(route, /const mcpToolCallLimit = browserAutomationRequest \? MCP_BROWSER_TOOL_MAX_CALLS_PER_TURN/);
  assert.match(route, /continueOnEmpty: \(\) =>/);
  assert.match(route, /浏览器自动化尚未完成/);
  assert.match(route, /重新获取当前页面快照/);
});

test('浏览器使用说明要求失败后核对状态并继续，而不是提前收尾', async () => {
  const guidance = await readFile(new URL('../lib/mcp/browser-guidance.ts', import.meta.url), 'utf8');
  assert.match(guidance, /操作被中断/);
  assert.match(guidance, /重新 browser_snapshot/);
  assert.match(guidance, /不能因为一次失败直接结束/);
});

test('浏览器自动化请求不会走普通联网搜索或文本直出', () => {
  assert.match(route, /likelyBrowserAutomationRequest/);
  assert.match(route, /const needsWebSearch = webDecision\.shouldSearch && !browserAutomationRequest/);
  assert.match(route, /const directStream =[^;]*!browserAutomationRequest/);
});

test(`浏览器下载不算交付物，不能掐掉 MCP 补轮`, () => {
  // 回归：浏览器自己写的 page-*.yml / console-*.log 会混进 generatedFiles，
  // 守卫只要还看 generatedFiles.length，就会永远为假——助手打开网页后就停在原地。
  assert.match(route, /let browserDownloadCount = 0;/);
  assert.match(route, /browserDownloadCount \+= downloaded\.files\.length;/);
  assert.match(route, /const generatedDeliveryCount = generatedFiles\.length - browserDownloadCount;/);
  const guard = route.match(/if \([^)]*!generated\.length[^)]*mcpToolCallCount > 0[^)]*\) \{/);
  assert.ok(guard, "MCP 补轮的守卫必须还在");
  assert.ok(!/!generatedFiles\.length/.test(guard[0]), "守卫不能再直接看 generatedFiles.length");
  assert.match(guard[0], /!generatedDeliveryCount/, "要看的是生成工具产出的文件数");
});

test('挂了浏览器控制就把 ref 用法写进系统提示', () => {
  // 回归：模型拿到快照后把 [ref=f5e14] 连前缀抄进 target、或自己编 CSS 选择器，
  // 于是每次点击都「找不到元素」，用户看到的是「浏览器打开了就停住」。
  assert.match(route, /import \{ BROWSER_TOOL_GUIDE \} from '@\/lib\/mcp\/browser-guidance';/);
  assert.match(route, /const agentSystemPromptInUse = /, '要有一个「这段系统提示真的在用」的判断');
  const guard = route.match(/if \(agentSystemPromptInUse && browserToolPrefixes\.some\(/);
  assert.ok(guard, '浏览器工具用法只在浏览器服务挂上这一轮时附加');
  assert.match(route, /system \+= `\\n\\n\$\{BROWSER_TOOL_GUIDE\}`;/, '要真的拼进系统提示');
  assert.match(route, /llmMessages\[0\] = \{ role: 'system', content: system \};/, '拼完要换掉真正下发的那条系统提示');
});

test(`正文被截成空时，再给模型一次带工具的原生调用机会`, () => {
  // 回归：实测模型把工具调用写成文本标记后整条回复只剩一个 "<"，直接返回用户什么也看不到。
  assert.match(route, /const cleanedMessage = stripToolCallMarkup\(plainMessage\)\.trim\(\);/);
  assert.match(route, /if \(!cleanedMessage && callableTools\.length\) \{/);
  assert.match(route, /tools: callableTools,/);
  assert.match(route, /不要把工具调用写成文本标记/);
  assert.match(route, /if \(!toolCalls\.length\) \{\s+plainMessage = cleanedMessage \|\| '当前对话模型没有返回内容。';/, '补不到工具才走原来的兜底文案');
});

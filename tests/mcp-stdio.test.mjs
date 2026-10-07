import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildMcpModule, importTwiceByPath } from './tools-build.mjs';

const mcp = await buildMcpModule();
const FIXTURE = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url));

after(() => mcp.closeStdioServer());

test('浏览器快照通过真实 stdio 链路附加 Shadow DOM 编辑器索引，普通服务不附加', async () => {
  const server = stdioServer({id:'browser-editors',catalogId:'playwright',env:{MCP_FIXTURE_BROWSER:'1'}});
  const snapshot = await mcp.callMcpTool(server,'browser_snapshot',{});
  assert.equal(snapshot.isError,false);
  assert.match(snapshot.text,/generic \[ref=e1\]/);
  assert.match(snapshot.text,/custom-editor div#editor/);
  const plain = await mcp.callMcpTool({...server,id:'plain-editors',catalogId:undefined},'browser_snapshot',{});
  assert.doesNotMatch(plain.text,/sanmaoEditors|custom-editor/);
  mcp.closeStdioServer('browser-editors');
  mcp.closeStdioServer('plain-editors');
});

function stdioServer(overrides = {}) {
  return {
    id: 'local',
    name: '本地测试服务',
    url: 'stdio://local',
    transport: 'stdio',
    enabled: true,
    allowWrite: true,
    command: process.execPath,
    args: [FIXTURE],
    ...overrides,
  };
}

test('stdio：tools/list 翻页取完并去重', async () => {
  const tools = await mcp.listMcpServerTools(stdioServer({ id: 'list' }));
  assert.deepEqual(tools.map((tool) => tool.name), ['ping', 'echo', 'fail', 'crash', 'slow', 'big', 'flaky']);
  mcp.closeStdioServer('list');
});

test('stdio：tools/call 返回文本，业务错误带 isError', async () => {
  const server = stdioServer({ id: 'call' });
  assert.deepEqual(await mcp.callMcpTool(server, 'echo', { text: '你好' }), { text: '你好', isError: false });
  const failed = await mcp.callMcpTool(server, 'fail', {});
  assert.equal(failed.isError, true);
  assert.match(failed.text, /出错了/);
  mcp.closeStdioServer('call');
});

test('stdio：超长结果截断并说明，不把 9000 字灌进上下文', async () => {
  const result = await mcp.callMcpTool(stdioServer({ id: 'big' }), 'big', {});
  assert.match(result.text, /结果过长已截断/);
  assert.ok(result.text.length < 9000);
  mcp.closeStdioServer('big');
});

test('stdio：同一个服务复用同一个进程', async () => {
  const server = stdioServer({ id: 'reuse' });
  await mcp.callMcpTool(server, 'ping', {});
  const first = mcp.stdioServerStatus('reuse').pid;
  await mcp.callMcpTool(server, 'ping', {});
  assert.ok(first);
  assert.equal(mcp.stdioServerStatus('reuse').pid, first, '第二次调用不该重新拉进程');
  mcp.closeStdioServer('reuse');
});

test('stdio：进程崩溃时报错；默认不重放，明确允许时才换新进程再来一次', async () => {
  const marker = path.join(os.tmpdir(), `sanmao-mcp-stdio-${process.pid}-${Date.now()}.marker`);
  const server = stdioServer({ id: 'crash', env: { MCP_FIXTURE_MARKER: marker } });
  try {
    await assert.rejects(() => mcp.callMcpTool(server, 'crash', {}), /code=3/);
    assert.equal(mcp.stdioServerStatus('crash').running, false);
    // 只是崩过一次的服务，下一次调用会自动拉起新进程，用户不用手动重启。
    assert.equal((await mcp.callMcpTool(server, 'ping', {})).text, 'pong');
    // 一次调用中途崩掉：默认不重放，写工具不能自动执行第二遍。
    await unlink(marker).catch(() => undefined);
    await assert.rejects(() => mcp.callMcpTool(server, 'flaky', {}), /code=4/);
    // 明确允许重试时才会拿新进程重来，第二次不再崩。
    assert.equal((await mcp.callMcpTool(server, 'flaky', {}, { retry: true })).text, 'recovered');
  } finally {
    mcp.closeStdioServer('crash');
    await unlink(marker).catch(() => undefined);
  }
});

test('stdio：相对路径的启动命令直接拒绝，不允许靠 PATH 解析', async () => {
  const problem = mcp.stdioCommandProblem(stdioServer({ command: 'node' }));
  assert.match(String(problem), /绝对路径/);
  await assert.rejects(() => mcp.callMcpTool(stdioServer({ id: 'relative', command: 'node' }), 'ping', {}), /绝对路径/);
  assert.equal(mcp.stdioCommandProblem(stdioServer({ command: '/definitely/not/here/mcp' }))?.includes('找不到'), true);
  assert.equal(mcp.stdioCommandProblem(stdioServer()), null);
});

test('stdio：本轮中止只取消这一次请求，进程还留着', async () => {
  const server = stdioServer({ id: 'abort' });
  await mcp.callMcpTool(server, 'ping', {});
  const pid = mcp.stdioServerStatus('abort').pid;
  const controller = new AbortController();
  const pending = mcp.callMcpTool(server, 'slow', { ms: 30_000 }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 60);
  await assert.rejects(() => pending, /停止/);
  assert.equal(mcp.stdioServerStatus('abort').pid, pid, '中止一次调用不该杀掉进程');
  assert.equal((await mcp.callMcpTool(server, 'ping', {})).text, 'pong');
  mcp.closeStdioServer('abort');
});

test('stdio：stderr 留尾部有上限，关掉之后进程不再运行', async () => {
  const server = stdioServer({ id: 'stderr' });
  await mcp.callMcpTool(server, 'ping', {});
  const status = mcp.stdioServerStatus('stderr');
  assert.ok(status.stderrTail.length > 0, 'stderr 要有记录，失败时才能给出原因');
  assert.ok(status.stderrTail.length <= mcp.MCP_STDIO_MAX_STDERR_CHARS);
  mcp.closeStdioServer('stderr');
  assert.equal(mcp.stdioServerStatus('stderr').running, false);
});

test('stdio：probe 走同一条协议，能列工具也能统计只读工具', async () => {
  const probe = await mcp.probeMcpServer(stdioServer({ id: 'probe' }));
  assert.equal(probe.tools.length, 7);
  assert.ok(probe.readOnly >= 3);
  // 协商结果跟着状态回传：本地服务没报版本时按「一致」记。
  assert.equal(probe.protocol.matched, true);
  assert.equal(mcp.stdioServerStatus('probe').protocol.negotiated, mcp.MCP_PROTOCOL_VERSION);
  mcp.closeStdioServer('probe');
});

test('stdio：会话表挂在 globalThis 上，模块热更新不会把进程表弄丢', async () => {
  const [first, second] = await importTwiceByPath('lib/mcp/stdio.mjs');
  assert.notEqual(first, second, '两次导入必须是两个模块实例，否则这个用例证明不了热更新');
  const server = stdioServer({ id: 'hmr' });
  await first.callStdioTool(server, 'ping', {});
  const pid = first.stdioServerStatus('hmr').pid;
  assert.ok(pid);
  // 换成另一个模块实例读同一张表：拿到的还是同一个进程，而不是「表是空的」再拉一个。
  assert.equal(second.stdioServerStatus('hmr').pid, pid);
  second.closeStdioServer('hmr');
  assert.equal(first.stdioServerStatus('hmr').running, false);
});

test('stdio：读取工具名超长或带非法字符时同样按 function name 规则过滤', async () => {
  const server = stdioServer({ id: 'naming' });
  const definitions = mcp.mcpToolDefinitions(server, await mcp.listMcpServerTools(server));
  assert.deepEqual(definitions.map((tool) => tool.name), ['naming__ping', 'naming__echo', 'naming__fail', 'naming__crash', 'naming__slow', 'naming__big', 'naming__flaky']);
  assert.equal(definitions[0].id, 'mcp:naming:ping');
  assert.equal(definitions[0].risk, 'read');
  assert.equal(definitions.find((tool) => tool.name === 'naming__fail')?.risk, 'external_side_effect');
  mcp.closeStdioServer('naming');
});

test('stdio：服务端报的协议版本进进程状态，版本对不上也照常调用', async () => {
  const server = stdioServer({ id: 'protocol', env: { MCP_FIXTURE_PROTOCOL_VERSION: '2024-11-05' } });
  try {
    assert.deepEqual(await mcp.callMcpTool(server, 'echo', { text: '你好' }), { text: '你好', isError: false });
    const protocol = mcp.stdioServerStatus('protocol').protocol;
    assert.equal(protocol.requested, mcp.MCP_PROTOCOL_VERSION);
    assert.equal(protocol.negotiated, '2024-11-05');
    assert.equal(protocol.matched, false);
    assert.equal(protocol.newerServerVersion, false);
  } finally {
    mcp.closeStdioServer('protocol');
  }
});

test('stdio：没握过手时状态里的协议是 null，面板不用额外判断缺字段', () => {
  assert.equal(mcp.stdioServerStatus('never-handshaken').protocol, null);
});

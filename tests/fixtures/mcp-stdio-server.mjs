/**
 * 测试用的本地 MCP stdio 服务：只实现 initialize / tools/list / tools/call，
 * 用换行分隔的 JSON-RPC 通信。行为刻意覆盖分页、错误、崩溃、慢响应几种情况，
 * 让 stdio 传输的边界条件都能在本地跑出来，不依赖任何外部服务。
 */
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';

const PAGE_SIZE = 2;
const TOOLS = [
  { name: 'ping', description: '返回 pong', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'echo', description: '把 text 原样返回', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'fail', description: '返回一个业务错误', inputSchema: { type: 'object', properties: {} } },
  { name: 'crash', description: '让进程直接退出', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: '延迟回复', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } }, annotations: { readOnlyHint: true } },
  { name: 'big', description: '返回超长文本', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'flaky', description: '第一次调用会崩，第二次才成功（用 MCP_FIXTURE_MARKER 记状态）', inputSchema: { type: 'object', properties: {} } },
];

// 启动就往 stderr 写一堆噪音：传输层要留下尾部但不能无限增长。
process.stderr.write(`${'x'.repeat(12000)}\n`);

function reply(id, payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...payload })}\n`);
}

function replyError(id, code, message) {
  reply(id, { error: { code, message } });
}

function callTool(id, name, args) {
  if (name === 'ping') return reply(id, { result: { content: [{ type: 'text', text: 'pong' }] } });
  if (name === 'echo') return reply(id, { result: { content: [{ type: 'text', text: String(args?.text ?? '') }] } });
  if (name === 'fail') return reply(id, { result: { content: [{ type: 'text', text: '出错了' }], isError: true } });
  if (name === 'crash') return process.exit(3);
  if (name === 'slow') {
    const ms = Number(args?.ms ?? 30_000);
    setTimeout(() => reply(id, { result: { content: [{ type: 'text', text: `等了 ${ms} 毫秒` }] } }), ms).unref?.();
    return undefined;
  }
  if (name === 'big') return reply(id, { result: { content: [{ type: 'text', text: 'y'.repeat(9000) }] } });
  if (name === 'flaky') {
    const marker = process.env.MCP_FIXTURE_MARKER;
    if (marker && !existsSync(marker)) {
      writeFileSync(marker, 'crashed once');
      return process.exit(4);
    }
    return reply(id, { result: { content: [{ type: 'text', text: 'recovered' }] } });
  }
  return replyError(id, -32602, `未知工具 ${name}`);
}

function handle(message) {
  const id = message?.id;
  if (message?.method === 'initialize') {
    // 允许用例把服务端报的版本换掉，用来验证「版本对不上也照常调用」。
    const protocolVersion = process.env.MCP_FIXTURE_PROTOCOL_VERSION || '2025-06-18';
    return reply(id, { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-stdio', version: '1.0' } } });
  }
  if (message?.method === 'notifications/initialized') return undefined;
  if (message?.method === 'tools/list') {
    const cursor = Number(message?.params?.cursor || 0);
    const page = TOOLS.slice(cursor, cursor + PAGE_SIZE);
    const next = cursor + PAGE_SIZE < TOOLS.length ? String(cursor + PAGE_SIZE) : undefined;
    return reply(id, { result: next ? { tools: page, nextCursor: next } : { tools: page } });
  }
  if (message?.method === 'tools/call') {
    return callTool(id, message?.params?.name, message?.params?.arguments);
  }
  return replyError(id, -32601, `未知方法 ${message?.method}`);
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message?.id === undefined) return handle(message);
  handle(message);
});
process.stdin.on('end', () => process.exit(0));

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/agent-client.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test('shared Agent client enforces the common context limit and stream contract', async () => {
  let request;
  const result = await withFetch(async (input, options) => {
    request = { input, options };
    return new Response(JSON.stringify({ ok: true, message: '完成', deliverable: 'TEXT' }), {
      headers: { 'content-type': 'application/json' },
    });
  }, () => client.requestAgent({
    source: 'canvas',
    messages: Array.from({ length: 15 }, (_, index) => ({ role: 'user', content: `消息 ${index + 1}` })),
    model: 'chat-model',
    deliverable: 'TEXT',
  }));

  const payload = JSON.parse(request.options.body);
  assert.equal(payload.messages.length, client.AGENT_CONTEXT_MESSAGE_LIMIT);
  assert.equal(payload.messages[0].content, '消息 4');
  assert.equal(payload.stream, true);
  assert.equal(payload.deliverable, 'TEXT');
  assert.equal(result.deliverable, 'TEXT');
});

test('shared Agent client parses split CRLF SSE frames in order', async () => {
  const events = [];
  const chunks = [
    'data: {"type":"status","message":"正在回答"}\r\n\r\n',
    'data: {"type":"delta","text":"第一段"}\r\n',
    '\r\ndata: {"type":"delta","text":"第二段"}\r\n\r\n',
    'data: {"type":"final","message":"第一段第二段","deliverable":"TEXT"}\r\n\r\n',
  ].map((value) => new TextEncoder().encode(value));
  const result = await withFetch(async () => new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } }), () => client.requestAgent({
    messages: [{ role: 'user', content: '描述图片' }],
    deliverable: 'TEXT',
  }, { onEvent: (event) => events.push(event.type) }));

  assert.equal(result.message, '第一段第二段');
  assert.equal(result.deliverable, 'TEXT');
  assert.deepEqual(events, ['status', 'delta', 'delta', 'final']);
});

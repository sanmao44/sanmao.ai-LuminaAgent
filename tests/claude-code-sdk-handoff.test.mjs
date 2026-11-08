import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

let temporaryRoot;
let server;
let serverUrl;

after(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('Agent SDK uses the Anthropic Messages base route and blocks tool handlers before handoff', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-claude-sdk-test-'));
  const requests = [];
  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });
    const requestPath = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method === 'HEAD' && requestPath === '/api/hello') {
      response.writeHead(200);
      response.end();
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', type: 'model' }] }));
      return;
    }
    if (request.method !== 'POST' || requestPath !== '/v1/messages') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Unexpected local mock route.' } }));
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_local', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 8, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will use the host tool.' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_use_local_1', name: 'mcp__sanmao__search', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"local integration"}' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 12 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    for (const [name, data] of events) response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  serverUrl = `http://127.0.0.1:${address.port}`;

  let handlerCalls = 0;
  let hookCall;
  const hostTool = tool('search', 'Search using the SANMAO host runtime.', { query: z.string() }, async () => {
    handlerCalls += 1;
    return { content: [{ type: 'text', text: 'should not run in the SDK process' }] };
  });
  const abortController = new AbortController();
  const stream = query({
    prompt: 'Use the available search tool for the requested information.',
    options: {
      abortController,
      cwd: temporaryRoot,
      env: {
        PATH: process.env.PATH || '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: temporaryRoot,
        USERPROFILE: temporaryRoot,
        TEMP: temporaryRoot,
        TMP: temporaryRoot,
        ANTHROPIC_BASE_URL: serverUrl,
        ANTHROPIC_AUTH_TOKEN: 'local-mock-token',
        CLAUDE_CONFIG_DIR: path.join(temporaryRoot, 'config'),
      },
      model: 'claude-sonnet-5-5',
      title: 'SANMAO local test',
      systemPrompt: { type: 'custom', prompt: 'Use only the provided host tool.' },
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      tools: [],
      allowedTools: ['mcp__sanmao__search'],
      permissionMode: 'dontAsk',
      mcpServers: { sanmao: createSdkMcpServer({ name: 'sanmao', version: '1.0.0', tools: [hostTool] }) },
      hooks: {
        PreToolUse: [{
          onFailure: 'block',
          hooks: [async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return { continue: true };
            hookCall = { name: input.tool_name, input: input.tool_input, id: input.tool_use_id };
            abortController.abort(new Error('handoff to SANMAO host'));
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Execute through SANMAO ToolRuntime.' } };
          }],
        }],
      },
    },
  });
  const messages = [];
  let streamError;
  try {
    for await (const message of stream) messages.push(message);
  } catch (error) {
    streamError = error;
  }

  const postRequests = requests.filter((request) => request.method === 'POST');
  assert.deepEqual(requests.slice(0, 2).map(({ method, url, body }) => ({ method, url, model: body?.model })), [
    { method: 'HEAD', url: '/api/hello', model: undefined },
    { method: 'POST', url: '/v1/messages?beta=true', model: 'claude-sonnet-5-5' },
  ], JSON.stringify({ hookCall, handlerCalls, streamError: String(streamError), messageTypes: messages.map((message) => message.type) }));
  assert.equal(postRequests.length, 1, JSON.stringify(postRequests.map(({ url, body }) => ({
    url,
    messages: body?.messages?.map(({ role, content }) => ({ role, content: Array.isArray(content) ? content.map((block) => block.type) : typeof content })),
  }))));
  assert.equal(requests.length, 2);
  assert.match(streamError instanceof Error ? streamError.message : String(streamError), /abort|cancel|close|interrupt/i);
  assert.equal(postRequests[0].authorization, 'Bearer local-mock-token');
  assert.equal(postRequests[0].body.model, 'claude-sonnet-5-5');
  assert.deepEqual(hookCall, { name: 'mcp__sanmao__search', input: { query: 'local integration' }, id: 'tool_use_local_1' });
  assert.equal(handlerCalls, 0);
  assert.equal(abortController.signal.aborted, true);
  assert.ok(messages.some((message) => message.type === 'assistant' && message.message.content.some((block) => block.type === 'tool_use')));
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildMcpExecutorModule } from './tools-build.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [page, route, history, providers, nativeSearch, webSearch, styles] = await Promise.all([
  read('app/page.tsx'),
  read('app/api/agent/route.ts'),
  read('lib/client-history.ts'),
  read('lib/providers.ts'),
  read('lib/native-web-search.ts'),
  read('lib/web-search.ts'),
  read('app/globals.css'),
]);
const sendButton = await read('components/AgentSendButton.tsx');
const { executeMcpTool } = await buildMcpExecutorModule();

test('Agent composer switches between send and an accessible stop action', () => {
  assert.ok(page.includes("import AgentSendButton from '@/components/AgentSendButton'"));
  assert.ok(sendButton.includes("className={`send-button ${busy ? 'stop-button' : ''}`}"));
  assert.ok(sendButton.includes('onClick={busy ? onStop : onSend}'));
  assert.ok(sendButton.includes("aria-label={busy ? '停止当前回答' : '发送'}"));
  assert.ok(sendButton.includes("<Icon name={busy ? 'stop' : 'send'} size={18} />"));
  assert.ok(styles.includes('.send-button.stop-button{'));
});

test('stopping preserves partial text, marks the assistant message, and clears busy state', () => {
  assert.ok(page.includes('const agentRequestsRef = useRef(new Map())'));
  assert.ok(page.includes("kind: 'retry'"));
  assert.ok(page.includes('retryVersionId'));
  assert.ok(page.includes("request.controller.abort(new Error('AGENT_CANCELLED'))"));
  assert.ok(page.includes("content: request.partialText?.trim() || '本轮回答已停止。'"));
  assert.ok(page.includes('interrupted: true'));
  assert.ok(page.includes('setChatBusy(sessionId, false)'));
  assert.ok(page.includes("message.role === 'assistant' && message.interrupted"));
  assert.ok(page.includes('className: "message-interrupted-badge"'));
  assert.ok(history.includes('interrupted?: boolean'));
});

test('a stopped reply remains part of the next turn and old requests cannot commit', () => {
  assert.ok(page.includes('const currentSessionMessages = pendingChatMessagesRef.current.get(sessionId) || messages'));
  assert.ok(page.includes('...currentSessionMessages.filter((message)=>!message.pending)'));
  assert.ok(page.includes('function isCurrentAgentRequest(sessionId, requestId)'));
  assert.ok(page.includes('if (!isCurrentRequest()) return;'));
  assert.ok(page.includes('const previous = chatSaveQueuesRef.current.get(id) || Promise.resolve()'));
  assert.ok(page.includes('agentRequest.partialText = nextContent'));
});

test('each conversation owns an independent request and only the active one is stoppable', () => {
  assert.ok(page.includes('const activeAgentBusy = activeChatId ? busyChatIds.includes(activeChatId) : false'));
  assert.ok(page.includes("const sessionId = activeChatId || uid('chat')"));
  assert.ok(page.includes('agentRequestsRef.current.set(sessionId, agentRequest)'));
  assert.ok(page.includes('const sessionId = activeChatIdRef.current;'));
  assert.ok(page.includes('agentRequestsRef.current.get(sessionId)'));
});

test('server cancellation reaches model, search, image, stream, and subprocess transports', () => {
  assert.ok(route.includes("request.signal.addEventListener('abort', abortFromClient"));
  assert.ok(route.includes('runNativeWebSearch(agentRuntime.provider, agentRuntime.model, llmMessages, plannedNativeQuery, requestController.signal)'));
  assert.ok(route.includes('chatCompletion(runtime.provider, runtime.model.rawId, payload, callSignal)'));
  assert.ok(route.includes('chatCompletionStream(runtime.provider, runtime.model.rawId, payload, callSignal)'));
  assert.ok(route.includes('chatCompletion(selectedRuntime.provider, selectedRuntime.model.rawId, payload, callSignal)'));
  assert.ok(route.includes('status: cancelled ? 499 : 502'));
  assert.ok(route.includes("cancelled ? '本轮 Agent 已停止。'"));
  assert.ok(providers.includes('signal: combineSignals(signal, 180000)'));
  assert.ok(nativeSearch.includes('signal: combineSignals(signal, 180000)'));
  assert.ok(webSearch.includes("execFileAsync('powershell.exe'"));
  assert.ok(webSearch.includes('signal,'));
});

test('shared MCP execution propagates cancellation without returning a synthetic success', async () => {
  const controller = new AbortController();
  const pending = executeMcpTool({
    callId: 'cancelled-mcp',
    server: { id: 'test', name: 'Test', url: 'http://test', enabled: true, allowWrite: false },
    meta: { serverId: 'test', serverName: 'Test', toolName: 'search', readOnly: true, blocked: false },
    args: { q: 'x' },
    signal: controller.signal,
    timeoutMs: 10_000,
    decision: 'call',
    retry: true,
    dependencies: {
      call: async (_server, _name, _args, options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')), { once: true });
      }),
    },
  });
  controller.abort(new Error('AGENT_CANCELLED'));
  await assert.rejects(pending, /AGENT_CANCELLED|aborted/);
});

test('cancelled searches do not enter provider fallback or cache a partial response', () => {
  assert.match(nativeSearch, /catch \(error\) \{\r?\n\s+throwIfAborted\(signal\);/);
  assert.ok(webSearch.includes('const attempts = await Promise.all(queries.map((variant) => searchWithFallback(variant, plan, apiConfigs, signal)))'));
  assert.ok(webSearch.includes('enrichResult(result, signal)'));
  assert.ok(route.includes('if (requestController.signal.aborted) throw requestController.signal.reason || error'));
  assert.ok(route.includes('if (signal?.aborted) return;'));
});

test('a running reply shows motion and a live clock so a long wait never looks frozen', () => {
  const normalized = page.replace(/\r\n/g, '\n');
  assert.ok(normalized.includes('pendingSince: Date.now(),'));
  assert.ok(normalized.includes('message.pendingSince ?'));
  assert.ok(normalized.includes("if (!generateBusy && !activeAgentBusy && section !== 'logs') return;"));
  assert.ok(normalized.includes('        generateBusy,\n        activeAgentBusy,\n        section\n    ]);'));
  assert.ok(styles.includes('.message-pending{display:flex'));
  assert.ok(styles.includes('.message-pending>.mini-loader{'));
  assert.ok(styles.includes('.message-pending-clock{'));
});

test('restored pending messages are converted to interrupted history', () => {
  assert.match(page, /if \(message\.pending\) \{/);
  assert.match(page, /页面刷新或重启后中断/);
  assert.match(page, /const \{ pending: _pending, activity: _activity, pendingSince: _pendingSince, \.\.\.rest \} = message/);
});

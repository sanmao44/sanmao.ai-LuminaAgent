import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('Agent composer switches between send and an accessible stop action', () => {
  assert.ok(page.includes("className: \`send-button \${activeAgentBusy ? 'stop-button' : ''}\`"));
  assert.ok(page.includes('onClick: ()=>activeAgentBusy ? void stopAgent() : void sendAgent()'));
  assert.ok(page.includes('"aria-label": activeAgentBusy ? \'停止当前回答\' : \'发送\''));
  assert.ok(page.includes('name: activeAgentBusy ? "stop" : "send"'));
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
  assert.ok(route.includes('runNativeWebSearch(agentRuntime.provider, agentRuntime.model, llmMessages, query, requestController.signal)'));
  assert.ok(route.includes('searchWeb(query, requestController.signal)'));
  assert.ok(route.includes('chatCompletion(agentRuntime.provider, agentRuntime.model.rawId'));
  assert.ok(route.includes('chatCompletionStream(agentRuntime.provider, agentRuntime.model.rawId'));
  assert.ok(route.includes('generateImage(imageRuntime.provider, imageRuntime.model.rawId'));
  assert.ok(route.includes('editImage(imageRuntime.provider, imageRuntime.model.rawId'));
  assert.ok(route.includes('status: cancelled ? 499 : 502'));
  assert.ok(route.includes("cancelled ? '本轮 Agent 已停止。'"));
  assert.ok(providers.includes('signal: combineSignals(signal, 180000)'));
  assert.ok(nativeSearch.includes('signal: combineSignals(signal, 180000)'));
  assert.ok(webSearch.includes("execFileAsync('powershell.exe'"));
  assert.ok(webSearch.includes('signal,'));
});

test('cancelled searches do not enter provider fallback or cache a partial response', () => {
  assert.ok(nativeSearch.includes('catch (error) {\n    throwIfAborted(signal);'));
  assert.ok(webSearch.includes('const attempts = await Promise.all(queryVariants.map((variant) => searchWithFallback(variant, news, apiConfigs, signal)))'));
  assert.ok(webSearch.includes('const enriched = await Promise.all(results.slice(0, 3).map((result) => enrichResult(result, signal)))'));
  assert.ok(route.includes('if (requestController.signal.aborted) throw requestController.signal.reason || error'));
  assert.ok(route.includes('if (signal?.aborted) return;'));
});

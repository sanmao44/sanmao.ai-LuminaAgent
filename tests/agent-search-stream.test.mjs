import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const route = await readFile(new URL('app/api/agent/route.ts', root), 'utf8');
const source = route.replace(/\r\n/g, '\n');

test('a web-search answer streams instead of landing as one frame', () => {
  assert.ok(source.includes("const searchedStream = wantsStream && !isCanvasSource && !skillContext.skills.length && !isTextPolishTask && needsWebSearch && !nativeSearchData"));
  assert.ok(source.includes('if (directStream || searchedStream) {'));
  assert.ok(source.includes('...(finalize ? { finalize } : {})'));
  assert.ok(source.includes('const finalize = searchedStream ? rewriteSearchRefusal : undefined;'));
});

test('native-search answers stream and keep their cleaned summary and sources', () => {
  assert.ok(source.includes('const nativeFallback = nativeFallbackAnswer(nativeSearch);'));
  assert.ok(source.includes("() => trackedChatCompletionStream(agentRuntime.provider, agentRuntime.model.rawId, { messages: llmMessages, tool_choice: 'none' }, requestController.signal).catch(() => null),"));
  assert.ok(source.includes('finalize: (text: string) => appendNativeSources(text, nativeSearch) || nativeFallback,'));
  assert.ok(source.includes('if (!nativeMessage) nativeMessage = nativeFallback;'));
});

test('a search refusal is still rewritten before the final event', () => {
  assert.ok(source.includes('const rewriteSearchRefusal = async (text: string) => {'));
  assert.ok(source.includes('plainMessage = await rewriteSearchRefusal(plainMessage);'));
  assert.ok(source.includes('return looksLikeSearchRefusal(answer) ? sourceBackedSearchFallback(searchData) : answer;'));
  const synthesis = source.split('搜索已经成功并返回候选来源').length - 1;
  assert.equal(synthesis, 1);
  assert.ok(source.includes('sourceBackedSearchFallback(searchData)'));
});

test('the stream can post-process the accumulated answer before the final event', () => {
  assert.ok(route.includes('finalize?: (text: string) => Promise<string> | string;'));
  assert.ok(source.includes('let finalized = streamedFinal;'));
  assert.ok(source.includes('try { finalized = await metadata.finalize(streamedFinal); }'));
  assert.ok(source.includes('const cleanedFinal = stripToolCallMarkup(finalized).trim();'));
  assert.ok(source.includes("? streamResult(null, { fallback: nativeMessage"));
});

test('tool rounds for skills, images and files stay buffered', () => {
  assert.ok(source.includes("const searchedStream = wantsStream && !isCanvasSource && !skillContext.skills.length && !isTextPolishTask && needsWebSearch && !nativeSearchData && !filesystemRequest && !callableTools.length && !identityQuestion && !imageGenerationRequest && !fileGenerationRequest && !artifactGenerationRequest;"));
  assert.ok(source.includes("if (wantsStream && !skillContext.skills.length && !isTextPolishTask && !identityQuestion) {"));
  assert.ok(source.includes('const shouldUseTools = useTools && !isCinematicDirectorTask;'));
});

test('DSML image calls are recovered before the image fallback and creative turns isolate MCP', () => {
  assert.ok(source.includes('const inlineToolCalls = rawToolCalls.length ? [] : parseInlineToolCalls(messageContent, callableTools);'));
  assert.ok(source.indexOf('const inlineToolCalls = rawToolCalls.length ? [] : parseInlineToolCalls(messageContent, callableTools);') < source.indexOf('if (imageGenerationRequest && !toolCalls.some'));
  assert.ok(source.includes('const creativeToolIsolation = imageGenerationRequest && !browserAutomationRequest && !filesystemRequest && !mcpAdminRequest;'));
  assert.ok(source.includes('const selectedMcpServers = creativeToolIsolation\n      ? []'));
});

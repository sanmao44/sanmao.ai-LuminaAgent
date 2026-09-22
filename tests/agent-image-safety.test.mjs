import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');

test('does not execute upstream image tool calls for text-only Agent requests', () => {
  assert.ok(route.includes('const imageToolsAllowed = imageGenerationRequest;'));
  assert.ok(route.includes('const blockedImageToolCall = !imageToolsAllowed && rawToolCalls.some(isImageToolCall);'));
  assert.ok(route.includes('rawToolCalls.filter((call: any) => !isImageToolCall(call))'));
  assert.ok(route.includes('if (!imageToolsAllowed) return { results };'));
  assert.ok(route.includes('图片请求已拦截，正在整理文字回答'));
});

test('canvas Agent nodes are explicitly text-only while the dock opts into execution', () => {
  assert.ok(route.includes("const isCanvasNodeExecution = isCanvasSource && body.executionMode !== 'agent-dock';"));
  assert.ok(route.includes("requestedDeliverable = 'TEXT';"));
  assert.ok(route.includes("const callableTools = toolSchemasFor(gatingContext, mcpTools, toolSelectionText, lazyGroupKeywords);"));
  assert.ok(route.includes("if (isCanvasNodeExecution) callableTools.splice(0, callableTools.length);"));
  assert.ok(route.includes("const webMode = isCanvasNodeExecution ? 'off' : resolveAgentWebMode("));
  assert.ok(route.includes("const artifactGenerationRequest = fileGenerationRequest"));
  assert.ok(route.includes("if (!isCanvasNodeExecution && isCanvasSource && canvasDocument) {"));
});

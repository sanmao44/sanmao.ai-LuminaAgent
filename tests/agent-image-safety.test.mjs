import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');

test('does not execute upstream image tool calls for text-only Agent requests', () => {
  assert.ok(route.includes('const imageToolsAllowed = imageGenerationRequest;'));
  assert.ok(route.includes('const blockedImageToolCall = !imageToolsAllowed && rawToolCalls.some(isImageToolCall);'));
  assert.ok(route.includes('rawToolCalls.filter((call: any) => !isImageToolCall(call))'));
  assert.ok(route.includes('if (!imageToolsAllowed) continue;'));
  assert.ok(route.includes('图片请求已拦截，正在整理文字回答'));
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const superCanvas = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');

test('canvas Agent requests suppress continuation directions without changing main Agent behavior', () => {
  assert.ok(route.includes("const isCanvasSource = sourceForLog === 'canvas';"));
  assert.match(
    route,
    /const ordinaryChatDirectionsInstructions = isCanvasSource\s*\n\s*\? .*超级画布输出规则：只输出本轮任务所需的最终结果。/s,
  );
  assert.ok(route.includes('普通文本回答结束时，追加一个标题为“你还可以继续”的小节'));
});

test('canvas Agent commits only a non-empty final message and clears streamed drafts on failure', () => {
  assert.match(
    superCanvas,
    /let finalEventReceived = false;[\s\S]*?let finalEventText = "";[\s\S]*?if \(event\.type === "final"\)[\s\S]*?finalEventText = String\(event\.message \|\| ""\)\.trim\(\);[\s\S]*?const responseText = String\(finalEventReceived \? finalEventText : response\.message \|\| ""\)\.trim\(\);\s*if \(!responseText\) throw new Error\("Agent 没有返回有效结果，请重试。"\);/,
  );
  assert.ok(superCanvas.includes('agentResponse: undefined,'));
  assert.ok(superCanvas.includes('text: String(node.data.agentPrompt || prompt),'));
  assert.ok(superCanvas.includes('role: "Agent 输入",'));
});

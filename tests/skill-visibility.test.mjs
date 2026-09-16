import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, page, dock, manager, canvasStyles, globals, client] = await Promise.all([
  readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/CanvasAgentDock.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/SkillManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/canvas.css", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/agent-client.ts", import.meta.url), "utf8"),
]);

test("a reply reports back which skills the agent actually read", () => {
  assert.match(route, /const usedSkills: Array<\{ id: string; name: string \}> = \[\];/);
  assert.match(route, /if \(!usedSkills\.some\(\(item\) => item\.id === skill\.id\)\) usedSkills\.push\(\{ id: skill\.id, name: skill\.name \}\);/);
  assert.match(route, /skills: metadata\.skills \|\| \[\]/);
  assert.match(route, /skills: usedSkills \}/);
  assert.match(client, /skills\?: Array<\{ id: string; name: string \}>;/);
});

test("both chat surfaces show the skills a reply used", () => {
  assert.match(page, /skills: Array\.isArray\(data\.skills\) && data\.skills\.length \? data\.skills : undefined,/);
  assert.match(page, /className: "message-skill-badge"/);
  assert.match(globals, /\.message\.assistant \.message-label \.message-skill-badge\{/);

  assert.match(dock, /skills\?: Array<\{ id: string; name: string \}>;/);
  assert.match(dock, /className="canvas-agent-dock-skills"/);
  assert.match(dock, /\.\.\.\(response\.skills\?\.length/);
  assert.match(canvasStyles, /\.canvas-agent-dock-skills span\{/);
});

test("the skill dialog explains how skills trigger so users do not have to guess", () => {
  assert.match(manager, /不需要手动挑、也不用关键词/);
  assert.match(manager, /回答上出现「技能 · 名称」就说明这轮用了它/);
  assert.match(manager, /直接对助手说“用 X 技能做/);
});
test("an enabled skill keeps the request on the tool round so the model can really read it", () => {
  assert.match(route, /const directStream = wantsStream && !skillContext\.skills\.length && !isTextPolishTask/);
  assert.match(route, /const cleanedFinal = stripToolCallMarkup\(streamedFinal\)\.trim\(\);/);
  assert.match(route, /plainMessage = stripToolCallMarkup\(plainMessage\)\.trim\(\) \|\| '当前对话模型没有返回内容。';/);
});
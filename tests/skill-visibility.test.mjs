import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, page, dock, manager, canvasStyles, globals, client, updateRoute, exportRoute, managerStyles, skillMenu, mentionEditor, skillInline] = await Promise.all([
  readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/CanvasAgentDock.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/SkillManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/canvas.css", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/agent-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/skills/[id]/update-check/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/skills/[id]/export/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/SkillManager.module.css", import.meta.url), "utf8"),
  readFile(new URL("../components/AgentSkillMenu.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/ReferenceMentionEditor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/SkillInlineText.tsx", import.meta.url), "utf8"),
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

test("the long skill explanation collapses behind a help button so the header stays compact", () => {
  assert.match(manager, /const \[helpOpen, setHelpOpen\] = useState\(false\);/);
  assert.match(manager, /aria-label="技能说明" title="技能说明" aria-expanded=\{helpOpen\} aria-controls="skill-manager-help"/);
  assert.match(manager, /\{helpOpen && <div id="skill-manager-help"/);
  assert.match(manager, /if \(helpOpen\) \{ event\.preventDefault\(\); setHelpOpen\(false\); \}/);
  assert.match(managerStyles, /\.titleRow \{ display: flex; align-items: center; gap: 9px; \}/);
  assert.match(managerStyles, /\.helpPanel \{/);
  assert.match(managerStyles, /\.help\[aria-expanded='true'\]/);
});

test("skill references render as icon chips in the composer and message bubbles", () => {
  assert.match(skillInline, /splitSkillMessage\(text\)/);
  assert.match(skillInline, /className="skill-inline-mention"/);
  assert.match(page, /_jsx\(SkillInlineText, \{/);
  assert.match(mentionEditor, /import \{ SKILL_MESSAGE_SOURCE \} from "@\/lib\/skill-picker";/);
  assert.match(mentionEditor, /data-skill-text=/);
  assert.match(mentionEditor, /contenteditable="false" data-skill-name=/);
  assert.match(globals, /\.skill-inline-mention\{/);
});

test("installed skills can be searched and edited from the panel", () => {
  assert.match(manager, /aria-label="搜索技能"/);
  assert.match(manager, /void openEditor\(skill\)/);
  assert.match(manager, /正在编辑「/);
  assert.match(manager, /editing \? '保存修改' : '保存技能'/);
  assert.match(manager, /用过 \$\{skill\.useCount\} 次/);
});

test("the skill button shows a badge when the assistant installed something to confirm", () => {
  assert.match(manager, /const pendingCount = pending\.length;/);
  assert.match(manager, /data-tooltip=\{pendingCount \? `技能 · \$\{pendingCount\} 个待确认` : '技能'\}/);
  assert.match(manager, /className=\{styles\.pendingBadge\}/);
  assert.match(managerStyles, /\.pendingBadge \{/);
  /* 面板没打开时也在助手忙完后刷新，否则角标不会出现。 */
  assert.match(manager, /if \(disabled \|\| open\) return;/);
});

test("the installed list sorts by enable state and recent use, and shows recent activity", () => {
  assert.match(manager, /skillMatchesTerms\(row\.skill, terms\)/);
  assert.match(manager, /Number\(b\.skill\.enabled\) - Number\(a\.skill\.enabled\)/);
  assert.match(manager, /最近使用 \$\{formatSkillAge\(skill\.lastUsedAt\)\}/);
  assert.match(manager, /function formatSkillAge\(value: number\)/);
});

test("删除与丢弃的二次确认会自动复位，技能菜单滚动跟随键盘选择", () => {
  assert.match(manager, /setTimeout\(\(\) => \{ setConfirming\(''\); setDiscarding\(''\); \}, 4000\)/);
  assert.match(skillMenu, /scrollIntoView\(\{ block: 'nearest' \}\)/);
});
test("an enabled skill keeps the request on the tool round so the model can really read it", () => {
  assert.match(route, /const directStream = wantsStream && !skillContext\.skills\.length && !isTextPolishTask/);
  assert.match(route, /const cleanedFinal = stripToolCallMarkup\(finalized\)\.trim\(\);/);
  assert.match(route, /plainMessage = stripToolCallMarkup\(plainMessage\)\.trim\(\) \|\| '当前对话模型没有返回内容。';/);
});
test("the tool round hands the assistant turn back so thinking models accept the follow-up", () => {
  // deepseek 之类的思维链模型在带 tool_calls 的助手消息上要求回传 reasoning_content，
  // 否则后续请求会被服务商以 400 拒绝，用户只能看到一句占位答案。
  assert.match(route, /const carriedAssistantFields = typeof message\?\.reasoning_content === 'string'/);
  assert.match(route, /tool_calls: toolCalls, \.\.\.carriedAssistantFields \}, \.\.\.toolResults\]/);
  assert.match(route, /const carriedFollowupFields = typeof followupMessage\?\.reasoning_content === 'string'/);
  assert.match(route, /tool_calls: followupCalls, \.\.\.carriedFollowupFields \}/);
  // 工具轮之后的失败不再静默降级成占位答案。
  assert.match(route, /console\.error\('\[Agent\] 工具轮之后的流式回答失败：', llmFailure\);/);
  assert.match(route, /fallback: `\$\{finalText\}（整理回答失败：\$\{llmFailure\.slice\(0, 200\)\}）`/);
});

test("installed skills can check source updates, export markdown, and pending cards show details", () => {
  assert.match(manager, /检查更新/);
  assert.match(manager, /\/update-check/);
  assert.match(manager, /更新重装/);
  assert.match(manager, /含脚本文件/);
  assert.match(manager, /附件：/);
  assert.match(manager, /上次检查/);
  assert.match(updateRoute, /planSkillUpdate\(skill, latest\.document\)/);
  assert.match(updateRoute, /installSkillFromDocument\(\{/);
  assert.match(updateRoute, /markSkillSourceChecked\(skill\.id/);
  assert.match(exportRoute, /skillMarkdown\(skill\)/);
  assert.match(exportRoute, /content-disposition/i);
});

test("multi-skill archives support checking a selection to install", () => {
  assert.match(manager, /勾选要安装的（可多选）/);
  assert.match(manager, /toggleChoice/);
  assert.match(manager, /安装所选/);
  assert.match(manager, /setSelectedKeys/);
  assert.match(manager, /来源目录/);
});

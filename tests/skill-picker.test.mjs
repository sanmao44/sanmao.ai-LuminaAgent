import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/skill-picker.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const skills = [
  { id: "weekly-report", name: "演示周报生成", description: "把零散记录整理成周报", enabled: true },
  { id: "color-grade", name: "影视调色", description: "给出调色参数", enabled: true },
  { id: "off-skill", name: "已停用技能", description: "不应出现", enabled: false },
];

test("输入框里只有整体是 /指令 时才当作技能快捷指令", () => {
  assert.equal(picker.skillSlashQuery("/"), "");
  assert.equal(picker.skillSlashQuery("/周报"), "周报");
  assert.equal(picker.skillSlashQuery("/weekly"), "weekly");
  assert.equal(picker.skillSlashQuery("用 /周报"), null);
  assert.equal(picker.skillSlashQuery("/周报 再写点别的"), null);
  assert.equal(picker.skillSlashQuery("/a/b"), null);
  assert.equal(picker.skillSlashQuery(""), null);
  assert.equal(picker.skillSlashQuery("普通问题"), null);
});

test("只列出启用中的技能，并按名称与简介过滤", () => {
  assert.deepEqual(picker.filterSkills(skills, "").map((skill) => skill.id), ["weekly-report", "color-grade"]);
  assert.deepEqual(picker.filterSkills(skills, "周报").map((skill) => skill.id), ["weekly-report"]);
  assert.deepEqual(picker.filterSkills(skills, "调色").map((skill) => skill.id), ["color-grade"]);
  assert.deepEqual(picker.filterSkills(skills, "weekly").map((skill) => skill.id), ["weekly-report"]);
  assert.deepEqual(picker.filterSkills(skills, "不存在"), []);
  assert.deepEqual(picker.filterSkills(null, ""), []);
});

test("别名标签也能过滤技能，方便用中文找英文技能", () => {
  const list = [
    { id: "bug-fixing", name: "Bug Fixing", description: "fix defects", tags: ["报错", "调试"], enabled: true },
    { id: "color-grade", name: "影视调色", description: "给出调色参数", enabled: true },
  ];
  assert.deepEqual(picker.filterSkills(list, "报错").map((skill) => skill.id), ["bug-fixing"]);
  assert.deepEqual(picker.filterSkills(list, "调试").map((skill) => skill.id), ["bug-fixing"]);
  assert.deepEqual(picker.filterSkills(list, "bug").map((skill) => skill.id), ["bug-fixing"]);
  assert.deepEqual(picker.filterSkills(list, "调色").map((skill) => skill.id), ["color-grade"]);
});


test("常用与最近使用的技能排在菜单前面", () => {
  const list = [
    { id: "a", name: "A", enabled: true, useCount: 1, lastUsedAt: 100 },
    { id: "b", name: "B", enabled: true, useCount: 9, lastUsedAt: 50 },
    { id: "c", name: "C", enabled: true, useCount: 0, lastUsedAt: 0 },
    { id: "d", name: "D", enabled: true, useCount: 3, lastUsedAt: 0 },
  ];
  assert.deepEqual(picker.filterSkills(list, "").map((skill) => skill.id), ["a", "b", "d", "c"]);
  const plain = [{ id: "x", name: "X", enabled: true }, { id: "y", name: "Y", enabled: true }];
  assert.deepEqual(picker.filterSkills(plain, "").map((skill) => skill.id), ["x", "y"]);
});

test("技能菜单支持空格分词匹配", () => {
  const list = [
    { id: "weekly-report", name: "演示周报", description: "把记录整理成周报", tags: ["汇报", "总结"], enabled: true },
    { id: "color-grade", name: "影视调色", description: "给出调色参数", enabled: true },
  ];
  assert.deepEqual(picker.filterSkills(list, "周报 汇报").map((skill) => skill.id), ["weekly-report"]);
  assert.deepEqual(picker.filterSkills(list, "周报 调色"), []);
  assert.deepEqual(picker.filterSkills(list, "调色 参数").map((skill) => skill.id), ["color-grade"]);
});

test("分词与匹配工具可复用：技能面板也用同一套规则", () => {
  assert.deepEqual(picker.skillQueryTerms("  周报   汇报 "), ["周报", "汇报"]);
  assert.deepEqual(picker.skillQueryTerms("a b c d e f g h"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(picker.skillQueryTerms(null), []);
  const skill = { id: "weekly-report", name: "演示周报", description: "把记录整理成周报", tags: ["汇报"], enabled: true };
  assert.equal(picker.skillMatchesTerms(skill, []), true);
  assert.equal(picker.skillMatchesTerms(skill, ["周报"]), true);
  assert.equal(picker.skillMatchesTerms(skill, ["周报", "汇报"]), true);
  assert.equal(picker.skillMatchesTerms(skill, ["周报", "调色"]), false);
  assert.equal(picker.skillMatchesTerms(skill, ["WEEKLY"]), true);
});

test("选中技能后写回输入框，并吃掉刚敲的 /指令", () => {
  assert.equal(picker.skillTriggerText("演示周报生成"), "用「演示周报生成」技能：");
  assert.equal(picker.skillMessageValue("/周报", "演示周报生成"), "用「演示周报生成」技能：");
  assert.equal(picker.skillMessageValue("", "影视调色"), "用「影视调色」技能：");
  assert.equal(picker.skillMessageValue("/周报 帮我把这段改得更好", "演示周报生成"), "用「演示周报生成」技能：帮我把这段改得更好");
  assert.equal(picker.skillMessageValue("把这段改得更好", "影视调色"), "用「影视调色」技能：把这段改得更好");
});

test("主界面把技能入口接到了输入框工具条和斜杠菜单", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const component = await readFile(new URL("../components/AgentSkillMenu.tsx", import.meta.url), "utf8");
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /const slashQuery = skillSlashQuery\(value\);/);
  assert.match(page, /onClick: \(\)=>agentSkillMenuOpen \? closeAgentSkillMenu\(\) : openAgentSkillMenu\(''\),/);
  assert.match(page, /className: `agent-quick-button agent-skill-button \$\{agentSkillMenuOpen \? 'active' : ''\}`/);
  assert.match(page, /_jsx\(AgentSkillMenu, \{/);
  assert.match(page, /openAgentSkillMenu\(''\)/);
  assert.match(component, /className="reference-mention-menu agent-mention-menu agent-skill-menu"/);
  assert.match(component, /还没有启用中的技能。点聊天区左上角的「技能」按钮可以安装或启用。/);
  assert.match(globals, /\.agent-skill-menu-copy strong\{/);
  assert.match(component, /agent-skill-menu-count/);
});

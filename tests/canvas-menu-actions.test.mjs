import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/menu-actions.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const menuActions = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("appends the Agent action without changing existing quick action order", () => {
  const calls = [];
  const existing = {
    primaryActions: [
      { id: "first", icon: "one", label: "First", onClick: () => calls.push("first") },
    ],
    menuGroups: [{ id: "more", icon: "more", label: "More", actions: [] }],
    dangerAction: { id: "delete", icon: "delete", label: "Delete", onClick: () => calls.push("delete") },
  };

  const result = menuActions.appendCanvasAgentAction(existing, () => calls.push("agent"), "Agent title");

  assert.deepEqual(result.primaryActions.map((action) => action.id), ["first", "ask-agent"]);
  assert.equal(result.menuGroups, existing.menuGroups);
  assert.equal(result.dangerAction, existing.dangerAction);
  assert.equal(result.primaryActions[1].title, "Agent title");
  result.primaryActions[1].onClick();
  assert.deepEqual(calls, ["agent"]);
});

test("prepends one Agent context group and preserves the original groups", () => {
  const calls = [];
  const existing = [{ label: "Canvas", actions: [] }];
  const result = menuActions.prependCanvasAgentContextMenuGroup(existing, () => calls.push("agent"), "Context title");

  assert.deepEqual(result.map((group) => group.label), ["Agent", "Canvas"]);
  assert.equal(result[1], existing[0]);
  assert.equal(result[0].actions[0].title, "Context title");
  result[0].actions[0].onClick();
  assert.deepEqual(calls, ["agent"]);
});

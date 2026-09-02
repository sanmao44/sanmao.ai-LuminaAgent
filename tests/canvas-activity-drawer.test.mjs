import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("task log detail button toggles the currently selected task", () => {
  const drawerStart = component.indexOf("function CanvasActivityDrawer(");
  assert.ok(drawerStart >= 0, "task log drawer should be present");
  const drawer = component.slice(drawerStart);
  assert.match(drawer, /selectedId === log\.id \? "收起详情" : "查看详情"/);
  assert.match(
    drawer,
    /setSelectedId\(\(value\) => value === log\.id \? null : log\.id\)/,
  );
});

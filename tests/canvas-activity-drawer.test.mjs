import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");

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

test("task log metadata keeps the important output details visually distinct", () => {
  assert.match(component, /className="canvas-task-log-meta-count"/);
  assert.match(component, /className="canvas-task-log-meta-duration"/);
  assert.match(component, /className="canvas-task-log-meta-size"/);
  assert.match(
    styles,
    /\.canvas-task-log-meta span\{[^}]*min-height:22px[^}]*font-size:8px[^}]*font-weight:800/,
  );
  assert.match(styles, /\.canvas-task-log-meta-count\{[^}]*color:var\(--accent-text\)/);
  assert.match(styles, /\.canvas-task-log-meta-duration\{[^}]*color:var\(--warning\)/);
});

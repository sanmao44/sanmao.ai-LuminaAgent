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

test("task log exposes unified activity status and persisted canvas lineage entry points", () => {
  assert.match(component, /activityTaskFromGenerationLog\(log\)/);
  assert.match(component, /canvasLineageForTask\(canvasDocument, activityTask\.sourceId \|\| log\.id\)/);
  assert.match(component, /className="canvas-task-log-detail canvas-task-log-lineage"/);
  assert.match(component, /onFocusNode\(record\.resultNodeId/);
  assert.match(component, /onFocusNode\(sourceId/);
  assert.match(component, /log\.chatId/);
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

test("task log keeps preview actions beside metadata instead of wasting a full row", () => {
  assert.match(styles, /\.canvas-task-log-card\{[^}]*grid-template-areas:"preview main status" "preview meta actions"/);
  assert.match(styles, /\.canvas-task-log-meta\{[^}]*grid-area:meta/);
  assert.match(styles, /\.canvas-task-log-actions\{[^}]*grid-area:actions/);
  assert.match(component, /if \(lightboxReturnPanel\) setActivePanel\(lightboxReturnPanel\);/);
});

test("task log result chips return to the task log panel after the media viewer closes", () => {
  const start = component.indexOf("const focusLogNode = useCallback(");
  assert.ok(start >= 0, "task log node focus handler should exist");
  assert.match(
    component.slice(start, start + 320),
    /focusCanvasNode\(nodeId, openMedia, openMedia && activePanel === "activity" \? "activity" : null\)/,
  );
  assert.match(component, /onFocusNode=\{focusLogNode\}/);
});

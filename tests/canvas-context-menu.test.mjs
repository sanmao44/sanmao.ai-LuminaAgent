import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("card context menus select the target and preserve selected multi-actions", () => {
  assert.match(component, /type CanvasContextMenuState/);
  assert.match(component, /nodeId\?: string/);
  assert.match(component, /if \(!selectedIds\.has\(node\.id\)\) selectNode\(node\)/);
  assert.match(component, /<CanvasNodeContextMenu/);
  assert.match(component, /className="canvas-node-context-menu"/);
  assert.match(component, /className=\{`canvas-context-menu\$\{className/);
  assert.match(component, /label: "复制节点"/);
  assert.match(component, /label: "创建副本"/);
  assert.match(component, /label: "复制图片"/);
  assert.match(component, /label: "调整参数"/);
  assert.match(component, /label: selectedIds\.size > 1 \? `删除/);
});

test("context paste uses the right-click world position while keyboard paste keeps its center fallback", () => {
  const start = component.indexOf("const pasteCanvasPayload = useCallback");
  const end = component.indexOf("const toggleAssetLibrary", start);
  assert.ok(start >= 0 && end > start, "paste implementation should be present");
  const paste = component.slice(start, end);
  assert.match(paste, /position \|\| screenToWorld\(center\.x, center\.y\)/);
  assert.match(paste, /handleFiles\(\[[\s\S]*?\], position\)/);
  assert.match(paste, /pasteCanvasPayload\(parsed, position\)/);
  assert.match(paste, /pasteFromClipboard = useCallback\(async \(position\?: Point\)/);
  assert.match(paste, /const placedOrigin = openNodePosition\(desiredOrigin, probe\)/);
  assert.match(component, /pasteFromClipboard\(contextMenu\?\.world\)/);
});

test("context menu keeps native controls isolated and remains bounded on small screens", () => {
  assert.match(component, /button,textarea,input,select/);
  assert.match(component, /event\.preventDefault\(\);\s+const point = stagePoint/);
  assert.match(component, /function CanvasContextMenuFrame/);
  assert.match(component, /placeCanvasContextMenu\(/);
  assert.match(component, /getBoundingClientRect\(\)/);
  assert.match(component, /new ResizeObserver\(schedule\)/);
  assert.match(component, /canvas-context-menu-body/);
  assert.doesNotMatch(component, /window\.innerHeight - 640/);
  assert.match(styles, /\.canvas-node-context-menu\{width:min\(320px,calc\(100vw - 16px\)\)/);
  assert.match(styles, /\.canvas-context-menu-body\{[^}]*overflow-y:auto/);
  assert.match(styles, /max-height:min\(560px,calc\(100dvh - 16px\)\)/);
  assert.match(styles, /\.canvas-node-context-menu \.canvas-menu-group-title small\{display:none\}/);
  assert.match(styles, /\.canvas-node-context-menu \.canvas-menu-item-context:disabled/);
  assert.match(styles, /@media\(max-width:420px\)\{\.canvas-node-context-menu/);
});

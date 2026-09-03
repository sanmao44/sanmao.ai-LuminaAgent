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
  const contextMenuStart = component.indexOf("const contextMenuGroups = useMemo");
  const contextMenuEnd = component.indexOf("function CanvasNodeContextMenu", contextMenuStart);
  assert.ok(contextMenuStart >= 0 && contextMenuEnd > contextMenuStart, "node context menu builder should exist");
  const contextMenu = component.slice(contextMenuStart, contextMenuEnd);
  const audioMenuStart = contextMenu.indexOf('if (node.type === "media" && node.data.kind === "audio")');
  const audioMenuEnd = contextMenu.indexOf('if (node.type === "media" && node.data.kind === "image")', audioMenuStart);
  assert.ok(audioMenuStart >= 0 && audioMenuEnd > audioMenuStart, "audio context menu should have its own branch");
  const audioContextMenu = contextMenu.slice(audioMenuStart, audioMenuEnd);
  const ordinaryContextMenu = `${contextMenu.slice(0, audioMenuStart)}${contextMenu.slice(audioMenuEnd)}`;
  const quickActionsStart = component.indexOf("const quickActions = useMemo");
  const quickActionsEnd = component.indexOf("const contextNode =", quickActionsStart);
  assert.ok(quickActionsStart >= 0 && quickActionsEnd > quickActionsStart, "node quick toolbar builder should exist");
  const quickActions = component.slice(quickActionsStart, quickActionsEnd);

  assert.match(component, /type CanvasContextMenuState/);
  assert.match(component, /menu: "node" \| "create" \| "tools"/);
  assert.match(component, /nodeId\?: string/);
  assert.match(component, /if \(!selectedIds\.has\(node\.id\)\) selectNode\(node\)/);
  assert.match(component, /<CanvasNodeContextMenu/);
  assert.match(component, /className="canvas-node-context-menu"/);
  assert.match(component, /className=\{`canvas-context-menu\$\{className/);
  assert.match(component, /label: "复制节点"/);
  assert.match(component, /label: "创建副本"/);
  assert.match(component, /const copies = duplicateNodes\(\s*docRef\.current,\s*\[\.\.\.selectedIds\],\s*\{ x: 48, y: 48 \},\s*true,\s*\)/);
  assert.match(contextMenu, /label: "复制图片"/);
  assert.match(contextMenu, /label: "图片编辑"/);
  assert.match(contextMenu, /label: "继续生成 \/ 变体"/);
  assert.match(contextMenu, /label: "下载"/);
  assert.match(contextMenu, /label: "加入资产"/);
  assert.match(component, /groups\.filter\(\(group\) => group\.actions\.length > 0\)/);
  assert.doesNotMatch(contextMenu, /label: "预览"/);
  assert.doesNotMatch(contextMenu, /label: "放大查看"/);
  assert.doesNotMatch(contextMenu, /label: "调整参数"/);
  assert.doesNotMatch(contextMenu, /局部编辑/);
  assert.doesNotMatch(contextMenu, /label: "作为参考"/);
  assert.doesNotMatch(ordinaryContextMenu, /id: "delete"/);
  assert.doesNotMatch(ordinaryContextMenu, /label: "删除"/);
  assert.doesNotMatch(ordinaryContextMenu, /label: selectedIds\.size > 1 \? `删除/);
  assert.match(audioContextMenu, /label: hasMedia \? "编辑 \/ 替换" : "添加音频"/);
  assert.match(audioContextMenu, /label: "播放"/);
  assert.match(audioContextMenu, /label: "下载"/);
  assert.match(audioContextMenu, /label: "加入资产"/);
  assert.match(audioContextMenu, /label: "删除"/);
  assert.match(quickActions, /useMemo<CanvasQuickToolbarActions>/);
  assert.match(quickActions, /id: "mask"/);
  assert.match(quickActions, /局部编辑/);
  assert.match(quickActions, /label: "图片编辑"/);
  assert.match(quickActions, /label: "作为参考"/);
  assert.match(quickActions, /label: "下载"/);
  assert.match(quickActions, /label: "加入资产"/);
  assert.match(quickActions, /label: "删除"/);
  assert.doesNotMatch(quickActions, /id: "edit"/);
  assert.doesNotMatch(quickActions, /label: "编辑"/);
  assert.match(quickActions, /id: "image-operations"/);
  assert.match(quickActions, /icon: "image-operations"/);
  assert.doesNotMatch(quickActions, /id: "more"/);
  assert.doesNotMatch(quickActions, /label: "更多"/);
  assert.doesNotMatch(quickActions, /label: "预览"/);
  assert.match(component, /aria-haspopup="menu"/);
  assert.match(component, /aria-controls={`canvas-quick-menu-\$\{node\.id\}-\$\{group\.id\}`}/);
  assert.match(component, /aria-expanded=\{openGroupId === group\.id\}/);
  assert.match(component, /className="canvas-node-quick-menu"/);
  assert.match(component, /const focusFirstAction = \(\) =>/);
  assert.match(component, /window\.document\.activeElement !== action/);
  assert.match(component, /closeMenu\(true\)/);
  assert.match(component, /addEventListener\("keydown", closeOnEscape, true\)/);
  assert.match(component, /querySelector\("\.canvas-node-quick-menu"\)/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(component, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(styles, /\.canvas-node-quick-menu\{width:min\(266px/);
  assert.match(styles, /\.canvas-node-quick-menu-trigger\.open/);
});

test("layer actions respect the selected node's real z-index and explain boundary no-ops", () => {
  const reorderStart = component.indexOf("const reorderSelection = useCallback");
  const reorderEnd = component.indexOf("const alignSelection = useCallback", reorderStart);
  assert.ok(reorderStart >= 0 && reorderEnd > reorderStart, "layer action handler should exist");
  const reorder = component.slice(reorderStart, reorderEnd);

  assert.match(reorder, /if \(next === docRef\.current\) \{[\s\S]*const boundary = action === "bring-to-back" \|\| action === "lower" \? "底层" : "顶层";[\s\S]*notify\(`选中的 \$\{ids\.length\} 个节点已在\$\{boundary\}`\)/);
  assert.match(component, /zIndex: \(typeof node\.zIndex === "number"[\s\S]*\+\s*\(dragging \? CANVAS_NODE_INTERACTION_OFFSET : 0\),/);
  assert.match(styles, /\.canvas-world-content>\.canvas-node-layer>\.canvas-node\.dragging\{z-index:var\(--canvas-z-node-interaction\)\}/);
  assert.doesNotMatch(styles, /\.canvas-world-content>\.canvas-node-layer>\.canvas-node\.selected,\.canvas-world-content>\.canvas-node-layer>\.canvas-node\.dragging/);
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
  assert.match(styles, /\.canvas-context-menu-body\{[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
  assert.match(styles, /\.canvas-context-menu-body\{[^}]*scrollbar-gutter:stable/);
  assert.match(styles, /max-height:min\(560px,calc\(100dvh - 16px\)\)/);
  assert.match(styles, /\.canvas-node-context-menu \.canvas-menu-group-title small\{display:none\}/);
  assert.match(styles, /\.canvas-node-context-menu \.canvas-menu-item-context:disabled/);
  assert.match(styles, /@media\(max-width:420px\)\{\.canvas-node-context-menu/);
});

test("blank canvas exposes compact, ungrouped canvas operations", () => {
  assert.match(component, /menu: "create"/);
  assert.match(component, /menu: "tools"/);
  assert.match(component, /ariaLabel="创建节点菜单"/);
  assert.match(component, /ariaLabel="画布操作菜单"/);
  assert.match(component, /className="canvas-tools-context-menu"/);
  assert.match(component, /pasteFromClipboard\(position\)/);
  assert.match(component, /<b>适应视图<\/b>/);
  const toolsMenuStart = component.indexOf('ariaLabel="画布操作菜单"');
  const toolsMenuEnd = component.indexOf("</CanvasContextMenuFrame>", toolsMenuStart);
  const toolsMenu = component.slice(toolsMenuStart, toolsMenuEnd);
  assert.match(toolsMenu, /className="canvas-menu-item canvas-menu-item-create"/);
  assert.match(toolsMenu, /<b>添加节点<\/b>/);
  assert.match(toolsMenu, /menu: "create"/);
  assert.match(toolsMenu, /<b>撤销<\/b>/);
  assert.match(toolsMenu, /<b>重做<\/b>/);
  assert.match(toolsMenu, /Ctrl\/Cmd \+ Z/);
  assert.match(toolsMenu, /Ctrl\/Cmd \+ Shift \+ Z/);
  assert.match(toolsMenu, /Ctrl\/Cmd \+ V/);
  assert.doesNotMatch(toolsMenu, /canvas-menu-group-title/);
  assert.doesNotMatch(toolsMenu, /canvas-menu-group-mark/);
  assert.doesNotMatch(toolsMenu, /<small>[^<]+<\/small>/);
  assert.equal((toolsMenu.match(/className="canvas-menu-divider"/g) || []).length, 2);
  assert.match(toolsMenu, /<b>上传<\/b>/);
  assert.doesNotMatch(toolsMenu, /导入图片 \/ 视频 \/ 音频/);
  const actionOrder = ["上传", "添加节点", "粘贴", "撤销", "重做", "一键整理", "适应视图"];
  const actionPositions = actionOrder.map((label) => toolsMenu.indexOf(`<b>${label}</b>`));
  assert.deepEqual(
    actionPositions,
    [...actionPositions].sort((a, b) => a - b),
  );
  assert.match(styles, /\.canvas-tools-context-menu \.canvas-menu-shortcut\{/);
  assert.match(styles, /\.canvas-tools-context-menu \.canvas-menu-item:disabled\{/);
  const arrangeIcon = toolsMenu.match(/<span className="canvas-menu-icon" aria-hidden="true">([^<]+)<\/span>\s*<span className="canvas-menu-copy">\s*<b>一键整理<\/b>/)?.[1];
  const fitIcon = toolsMenu.match(/<span className="canvas-menu-icon" aria-hidden="true">([^<]+)<\/span>\s*<span className="canvas-menu-copy">\s*<b>适应视图<\/b>/)?.[1];
  assert.equal(arrangeIcon, "⌗");
  assert.equal(fitIcon, "⛶");
  assert.notEqual(arrangeIcon, fitIcon);
  assert.match(styles, /\.canvas-tools-context-menu\{width:min\(252px,calc\(100vw - 16px\)\)/);
  assert.match(styles, /\.canvas-tools-context-menu \.canvas-menu-item\{min-height:39px/);
});

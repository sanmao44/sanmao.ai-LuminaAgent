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

test("variant generators expose shared contextual help in cards and editors", () => {
  assert.match(component, /function CanvasGeneratorHelp\(\{ kind \}: \{ kind: CanvasMediaKind \}\)/);
  assert.equal((component.match(/<CanvasGeneratorHelp kind=\{data\.kind === "video" \? "video" : "image"\} \/>/g) || []).length, 3);
  assert.match(component, /aria-label=\{`查看\$\{label\}使用方法`\}/);
  assert.match(component, /aria-expanded=\{open\}/);
  assert.match(component, /aria-controls=\{panelId\}/);
  assert.match(component, /role="region"/);
  assert.match(component, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(component, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(component, /共同提示词会作为每一条变体要求的基础/);
  assert.match(component, /变体要求每行一条，最多 8 条/);
  assert.match(component, /输入 @编号/);
  assert.match(component, /视频会按变体要求逐条串行生成/);
  assert.match(component, /预计数量 = 变体条数 × 每条图片数量/);
  assert.match(component, /一次重试全部失败项/);
});

test("variant generator help stays in the node flow and supports visual states", () => {
  assert.match(styles, /\.canvas-generator-head\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto;grid-template-rows:auto auto/);
  assert.match(styles, /\.canvas-node-variant-editor-head\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;grid-template-rows:auto auto/);
  assert.match(styles, /\.canvas-generator-help-popover\{[^}]*grid-column:1\/-1;grid-row:2/);
  assert.match(styles, /\.canvas-generator-help-popover\[data-kind="image"\]/);
  assert.match(styles, /\.canvas-generator-help-popover\[data-kind="video"\]/);
  assert.match(styles, /\.canvas-generator-help-trigger:focus-visible/);
  assert.match(styles, /@media\(max-width:720px\)\{\.canvas-generator-help-popover/);
  assert.match(styles, /prefers-reduced-motion:reduce\).*canvas-generator-help/);
  assert.match(styles, /\.canvas-node:has\(\.canvas-generator-card\) \.canvas-generator-prompt\{[^}]*flex:0 0 auto/);
  assert.match(styles, /\.canvas-generator-section-heading/);
  assert.match(styles, /\.canvas-node:has\(\.canvas-generator-card\) \.canvas-generator-head b\{[^}]*font-size:15px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-node-variant-editor>\.reference-mention-editor \.reference-mention-editor-content\{[^}]*font-size:12px/);
  assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(component, /data-kind=\{kind\}/);
  assert.match(styles, /\.canvas-node:has\(\.canvas-generator-card\)\{[^}]*border:1px solid/);
  assert.match(styles, /\.canvas-node:has\(\.canvas-generator-card\)::before/);
  assert.match(styles, /\.canvas-generator-help-trigger\[data-kind="image"\]/);
  assert.match(styles, /\.canvas-generator-help-trigger\[data-kind="video"\]/);
  assert.doesNotMatch(component, /collapsedGeneratorOutputIds/);
  assert.match(component, /const visibleCanvasNodes = useMemo\(\s*\(\) => sortCanvasNodesByLayer\(document\.nodes\)/);
  assert.match(component, /let nextResultPlacement = docRef\.current\.nodes\.filter\(/);
  assert.match(component, /const column = placement % 2/);
  assert.match(component, /const row = Math\.floor\(placement \/ 2\)/);
  assert.match(component, /x: generator\.x \+ nodeSize\(generator\)\.w \+ 110 \+ column \* 380/);
  assert.match(component, /y: generator\.y \+ row \* 300/);
  assert.match(styles, /\.canvas-generator-head>\.canvas-generator-help-trigger\{grid-column:3;grid-row:1\}/);
  assert.match(styles, /\.canvas-node-variant-editor-head>\.canvas-generator-help-trigger\{grid-column:2;grid-row:1\}/);
  assert.match(styles, /\.canvas-generator-help-popover\{[^}]*grid-column:1\/-1/);
});

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
  assert.equal((component.match(/<CanvasGeneratorHelp kind=\{data\.kind === "video" \? "video" : "image"\} \/>/g) || []).length, 2);
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
  assert.match(styles, /\.canvas-generator-help\{display:contents\}/);
  assert.match(styles, /\.canvas-generator-help-popover\{[^}]*flex:1 0 100%/);
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
});

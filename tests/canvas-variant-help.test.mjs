import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/canvas/CanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const deck = await readFile(
  new URL("../components/canvas/CanvasDeck.tsx", import.meta.url),
  "utf8",
);
const variant = await readFile(
  new URL("../components/canvas/CanvasVariantEditors.tsx", import.meta.url),
  "utf8",
);
const generatorCard = await readFile(
  new URL("../components/canvas/CanvasGeneratorNodeCard.tsx", import.meta.url),
  "utf8",
);
const nodeEditor = await readFile(
  new URL("../components/canvas/CanvasNodeEditorPopover.tsx", import.meta.url),
  "utf8",
);
const nodeCard = await readFile(
  new URL("../components/canvas/CanvasNodeCard.tsx", import.meta.url),
  "utf8",
);
const source = component + "\n" + deck + "\n" + nodeEditor + "\n" + nodeCard + "\n" + variant + "\n" + generatorCard;
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const generatorStyles = await readFile(
  new URL("../app/canvas-generator-node.css", import.meta.url),
  "utf8",
);
const variantStyles = await readFile(
  new URL("../app/canvas-variant-editor.css", import.meta.url),
  "utf8",
);
const smartVariantStyles = await readFile(
  new URL("../app/canvas-smart-variant.css", import.meta.url),
  "utf8",
);
const combinedStyles = `${styles}\n${generatorStyles}\n${variantStyles}\n${smartVariantStyles}`;

test("variant generators expose shared contextual help in cards and editors", () => {
  assert.match(source, /(?:export )?function CanvasGeneratorHelp\(\{ kind \}: \{ kind: CanvasMediaKind \}\)/);
  assert.match(source, /(?:export )?const CanvasVariantRequirementsEditor = memo\(function CanvasVariantRequirementsEditor\(/);
  assert.match(source, /className=\{\`canvas-variant-list-row/);
  assert.equal((source.match(/<CanvasGeneratorHelp/g) || []).length, 3);
  assert.equal((source.match(/<CanvasVariantRequirementsEditor/g) || []).length, 3);
  assert.match(source, /aria-label=\{`查看\$\{label\}使用方法`\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /role="region"/);
  assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /event\.key === "Backspace" && isEmpty/);
  assert.match(source, /const pastedRows = compactVariantRequirementRows\(/);
  assert.match(source, /type ClipboardEvent as ReactClipboardEvent/);
  assert.match(source, /event: ReactClipboardEvent<HTMLDivElement>/);
  assert.match(source, /event\.nativeEvent\.isComposing/);
  assert.doesNotMatch(source, /MAX_CANVAS_VARIANTS/);
  assert.doesNotMatch(source, /超过 \$\{MAX_CANVAS_VARIANTS\} 条，已截断多余内容/);
  assert.match(source, /aria-label=\{`继续添加第 \$\{index \+ 1\} 条`\}/);
  assert.match(source, /title="继续添加"/);
  assert.match(source, /共同提示词会作为每一条变体要求的基础/);
  assert.match(source, /逐条编辑、回车新增；空行会自动忽略，也可以继续添加更多条目。/);
  assert.match(source, /在每条里输入 @编号/);
  assert.match(source, /视频会按变体要求逐条串行生成/);
  assert.match(source, /预计数量 = 变体条数 × 每条图片数量/);
  assert.match(source, /一次重试全部失败项/);
});

test("variant generator help stays in the node flow and supports visual states", () => {
  assert.match(combinedStyles, /\.canvas-generator-head\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto;grid-template-rows:auto auto/);
  assert.match(combinedStyles, /\.canvas-node-variant-editor-head\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;grid-template-rows:auto auto/);
  assert.match(combinedStyles, /\.canvas-node-variant-editor-head>label small\{overflow:visible;text-overflow:clip;white-space:normal;line-height:1\.25/);
  assert.match(combinedStyles, /\.canvas-generator-help-popover\{[^}]*grid-column:1\/-1;grid-row:2/);
  assert.match(combinedStyles, /\.canvas-generator-help-popover\[data-kind="image"\]/);
  assert.match(combinedStyles, /\.canvas-generator-help-popover\[data-kind="video"\]/);
  assert.match(combinedStyles, /\.canvas-generator-help-trigger:focus-visible/);
  assert.match(combinedStyles, /@media\(max-width:720px\)\{\.canvas-generator-help-popover/);
  assert.match(combinedStyles, /prefers-reduced-motion:reduce\).*canvas-generator-help/);
  assert.match(combinedStyles, /\.canvas-node:has\(\.canvas-generator-card\) \.canvas-generator-prompt\{[^}]*flex:0 0 auto/);
  assert.match(combinedStyles, /\.canvas-generator-section-heading/);
  assert.match(combinedStyles, /\.canvas-node:has\(\.canvas-generator-card\) \.canvas-generator-head b\{[^}]*font-size:15px/);
  assert.match(combinedStyles, /\.canvas-variant-list-row\{display:flex;align-items:flex-start;gap:6px/);
  assert.match(combinedStyles, /\.canvas-variant-list-row-editor \.reference-mention-editor-content\{[^}]*white-space:pre;[^}]*overflow-x:auto;[^}]*overflow-y:hidden/);
  assert.match(combinedStyles, /\.canvas-variant-list-actions button:focus-visible:not\(\:disabled\)/);
  assert.match(combinedStyles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-count\{[^}]*font-variant-numeric:tabular-nums/);
  assert.match(combinedStyles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /data-kind=\{kind\}/);
  assert.match(combinedStyles, /\.canvas-node:has\(\.canvas-generator-card\)\{[^}]*border:1px solid/);
  assert.match(combinedStyles, /\.canvas-node:has\(\.canvas-generator-card\)::before/);
  assert.match(combinedStyles, /\.canvas-generator-help-trigger\[data-kind="image"\]/);
  assert.match(combinedStyles, /\.canvas-generator-help-trigger\[data-kind="video"\]/);
  assert.doesNotMatch(source, /collapsedGeneratorOutputIds/);
  assert.match(source, /const visibleCanvasNodes = useMemo\(\s*\(\) => sortCanvasNodesByLayer\(document\.nodes\)/);
  assert.match(source, /const column = placement % 2/);
  assert.match(source, /const row = Math\.floor\(placement \/ 2\)/);
  assert.match(source, /x: generator\.x \+ nodeSize\(generator\)\.w \+ 110 \+ column \* 380/);
  assert.match(source, /y: generator\.y \+ row \* 300/);
  assert.match(combinedStyles, /\.canvas-generator-head>\.canvas-generator-help-trigger\{grid-column:3;grid-row:1\}/);
  assert.match(combinedStyles, /\.canvas-node-variant-editor-head>\.canvas-generator-help-trigger\{grid-column:2;grid-row:1\}/);
  assert.match(combinedStyles, /\.canvas-generator-help-popover\{[^}]*grid-column:1\/-1/);
});

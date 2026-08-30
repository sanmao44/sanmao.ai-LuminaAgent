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

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `${startText} should be present`);
  return source.slice(start, end);
}

test("Agent response lightbox uses a dedicated large edit mode", () => {
  const lightbox = sliceBetween(
    component,
    "function CanvasTextLightbox({",
    "function CanvasPanelShell(",
  );
  assert.match(lightbox, /canvas-text-lightbox\$\{editing \? " is-editing"/);
  assert.match(lightbox, /className="canvas-text-edit-stage"/);
  assert.match(lightbox, /保存修改/);
  assert.match(lightbox, /取消编辑/);
  assert.match(lightbox, /回复内容不能为空/);
  assert.doesNotMatch(lightbox, /AI 优化/);
  assert.doesNotMatch(lightbox, /写入当前提示词/);
  assert.doesNotMatch(lightbox, /创建文本节点/);
  assert.doesNotMatch(lightbox, /canvas-text-result-panel/);
});

test("Agent response selection toolbar only operates on selected body text", () => {
  const lightbox = sliceBetween(
    component,
    "function CanvasTextLightbox({",
    "function CanvasPanelShell(",
  );
  assert.match(lightbox, /const bodyRef = useRef/);
  assert.match(lightbox, /body\.contains\(current\.anchorNode\)/);
  assert.match(lightbox, /body\.contains\(current\.focusNode\)/);
  assert.match(lightbox, /handleOutsidePointer/);
  assert.match(lightbox, /closest\("\.canvas-text-selection-toolbar"\)/);
  assert.match(lightbox, /onMouseUp=\{updateSelection\}/);
  assert.match(lightbox, /className=\{`canvas-text-selection-toolbar/);
  assert.match(lightbox, /复制选段/);
  assert.match(lightbox, /创建 Agent 节点/);
  assert.match(lightbox, /转图片/);
  assert.match(lightbox, /onCreateAgentNode\(node, value\)/);
  assert.match(lightbox, /onUseAsImagePrompt\(node, value\)/);
});

test("selected text creates a connected Agent input node without starting generation", () => {
  const creator = sliceBetween(
    component,
    "const createViewerAgentNode = useCallback",
    "const updateTextNode = useCallback",
  );
  assert.match(creator, /const prompt = value\.trim\(\)/);
  assert.match(creator, /role: "Agent 输入"/);
  assert.match(creator, /status: "idle"/);
  assert.match(creator, /addEdge\(/);
  assert.match(creator, /"manual",\s*"context"/);
  assert.match(creator, /setExpandedEditorId\(agentNode\.id\)/);
  assert.doesNotMatch(creator, /runGeneration|runGenerationRef|generateCanvasAgent/);
});

test("editing a completed reply preserves its Agent response identity", () => {
  const updater = sliceBetween(
    component,
    "const updateTextNode = useCallback",
    "const writeTextToPrompt = useCallback",
  );
  assert.match(updater, /if \(!value\.trim\(\)\)/);
  assert.match(updater, /agentResponse: value/);
  assert.match(updater, /status: "completed"/);
  assert.match(updater, /statusLabel: "Agent 已回复"/);
  assert.match(updater, /item\.data\.agentResponse \|\| String\(item\.data\.role[^}]+agentResponse: value/);
});

test("lightbox edit and selection styles are responsive", () => {
  assert.match(styles, /\.canvas-text-lightbox\.is-editing\{[^}]*width:min\(1080px,100%\)/);
  assert.match(styles, /\.canvas-text-edit-stage\{[^}]*flex:1/);
  assert.match(styles, /\.canvas-text-selection-toolbar\{[^}]*position:fixed/);
  assert.match(styles, /\.canvas-text-selection-toolbar\.below\{/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*?\.canvas-text-lightbox\.is-editing/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const parameterEditor = await readFile(
  new URL("../components/CreationParameterEditor.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("node editor exposes an accessible expand/collapse control", () => {
  assert.match(component, /className="canvas-node-editor-expand"/);
  assert.match(component, /title=\{promptExpanded \? "收回编辑" : "放大编辑"\}/);
  assert.match(component, /aria-label=\{promptExpanded \? "收回编辑" : "放大编辑"\}/);
  assert.match(component, /aria-expanded=\{promptExpanded\}/);
  assert.match(component, /data-prompt-expanded=\{promptExpanded \? "true" : "false"\}/);
});

test("prompt editor measures content and caps scrolling in both display modes", () => {
  assert.match(component, /const promptRef = useRef<HTMLTextAreaElement \| null>\(null\)/);
  assert.match(component, /textarea\.style\.height = "auto"/);
  assert.match(component, /const contentHeight = textarea\.scrollHeight/);
  assert.match(component, /promptExpanded \? \(mobile \? 360 : 460\) : \(mobile \? 220 : 260\)/);
  assert.match(component, /textarea\.style\.overflowY = contentHeight > maxHeight \? "auto" : "hidden"/);
});

test("expanded editor is centered and remains responsive", () => {
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*position:fixed/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*width:min\(860px,calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*max-height:calc\(100vh - 32px\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-columns\{[^}]*grid-template-columns/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-settings,\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-editor-references,\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-reference-draft-strip\{display:none!important\}/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-prompt-wrap\{display:flex;flex:1;flex-direction:column/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-prompt-wrap>textarea\{flex:1 1 auto/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*\.canvas-node-editor-popover\.is-prompt-expanded\{width:calc\(100vw - 16px\)/);
});

test("editor keeps references, variant requirements, parameters, mentions and generation", () => {
  assert.match(component, /<CanvasNodeReferenceStrip/);
  assert.match(component, /<CanvasReferenceDraftStrip/);
  assert.match(component, /<CreationParameterEditor/);
  assert.match(component, /className="canvas-node-variant-editor"/);
  assert.match(component, /className="canvas-node-mention-menu"/);
  assert.match(component, /onGenerate\(node\)/);
  assert.match(component, /setMentionState\(null\)/);
  assert.match(component, /setPromptExpanded\(false\)/);
});

test("image continuation uses the ordinary image API and keeps lineage on image nodes", () => {
  const start = component.indexOf("const runImageContinuation = useCallback");
  const end = component.indexOf("const runReuseGeneration = useCallback", start);
  assert.ok(start >= 0 && end > start, "image continuation implementation should be present");
  const continuation = component.slice(start, end);

  assert.match(continuation, /generateCanvasImage\(/);
  assert.match(continuation, /addReference\(\s*source\.id/);
  assert.match(continuation, /referenceIds: \[\.\.\.resolvedReferenceIds\]/);
  assert.match(continuation, /parentNodeId: source\.id/);
  assert.match(continuation, /reuseSourceNodeId: source\.id/);
  assert.match(continuation, /kind: "lineage"/);
  assert.match(continuation, /createMedia\(\s*"image"/);
  assert.match(continuation, /result\.images\.forEach/);
  assert.match(continuation, /status: "failed"/);
  assert.match(continuation, /referenceEdges\.map/);
  assert.doesNotMatch(continuation, /sourceGeneratorId/);
  assert.doesNotMatch(continuation, /variantBatchId|variantIndex/);
  assert.doesNotMatch(continuation, /createGenerator\(/);
});

test("image node editing persists parameters without turning uploads into generated media", () => {
  assert.match(component, /role: "参考素材",\s*params: defaultParams\(asset\.kind, runtime\)/);
  assert.match(component, /generation: item\.data\.generation/);
  assert.match(component, /params: clone\(settings\)/);
  assert.match(component, /prompt: value/);
  assert.match(component, /if \(item\.type === "prompt"\)/);
  const start = component.indexOf("const updatePrompt = useCallback");
  const end = component.indexOf("const updateVariantRequirements = useCallback", start);
  const updatePrompt = component.slice(start, end);
  assert.match(updatePrompt, /node\.data\.generation\s*\?/);
  assert.doesNotMatch(updatePrompt, /generation:\s*\{\s*kind:/);
});

test("regular editor stays below its node in the stacked main-composer layout", () => {
  assert.match(component, /fitCanvasNodeEditorBelow\(/);
  assert.match(component, /data-placement="bottom"/);
  assert.match(component, /maxHeight: promptExpanded \? undefined : position\.maxHeight/);
  assert.doesNotMatch(component, /useTopPlacement/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-columns\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-settings>.creation-parameter-editor\.image \.creation-parameter-grid\.primary\{grid-template-columns:repeat\(4,minmax\(0,1fr\)/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-settings>.creation-parameter-editor\.image \.creation-parameter-grid\.primary>.creation-field\.model\{grid-column:1\/-1\}/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-actions\{min-height:55px/);
});

test("multi-select layout toolbar exposes alignment and distribution icons only for ordinary nodes", () => {
  assert.match(component, /const CANVAS_ALIGNMENT_OPTIONS/);
  assert.match(component, /const CANVAS_DISTRIBUTION_OPTIONS/);
  assert.match(component, /alignCanvasNodes\(\s*docRef\.current,\s*\[\.\.\.selectedIds\],\s*alignment,?\s*\)/);
  assert.match(component, /distributeCanvasNodes\(\s*docRef\.current,\s*\[\.\.\.selectedIds\],\s*direction,?\s*\)/);
  assert.match(component, /selectedNodes\.length >= 2 && !selectedGroupId/);
  assert.match(component, /className="canvas-selection-layout-toolbar"/);
  assert.match(component, /className="canvas-selection-layout-group alignment"/);
  assert.match(component, /className="canvas-selection-layout-group distribution"/);
  assert.match(component, /disabled=\{disabled\}/);
  assert.match(component, /至少选择 3 个节点后可/);
  ["左对齐", "水平居中", "右对齐", "顶部对齐", "垂直居中", "底部对齐"].forEach((label) => {
    assert.match(component, new RegExp(`label: "${label}"`));
  });
  ["水平均匀分布", "垂直均匀分布"].forEach((label) => {
    assert.match(component, new RegExp(`label: "${label}"`));
  });
  assert.match(component, /function CanvasLayoutIcon/);
  assert.match(component, /title=\{option\.title\}/);
  assert.match(component, /aria-label=\{option\.title\}/);
  assert.match(component, /canvas-selection-toolbar,\.canvas-selection-layout-toolbar/);
  assert.match(component, /commit\(\(\) => result\.document\)/);
  assert.doesNotMatch(component, /canvas-selection-align-actions/);
  assert.match(styles, /\.canvas-selection-layout-toolbar\{position:absolute/);
  assert.match(styles, /\.canvas-selection-layout-group\.alignment/);
  assert.match(styles, /\.canvas-selection-layout-group\.distribution/);
  assert.match(styles, /\.canvas-selection-layout-tooltip::after/);
});

test("canvas image parameters collapse into a compact one-line collection", () => {
  assert.match(parameterEditor, /canvas-parameter-collection/);
  assert.match(parameterEditor, /aria-controls="canvas-image-parameter-drawer"/);
  assert.match(parameterEditor, /aria-expanded=\{parameterDrawerOpen\}/);
  assert.match(parameterEditor, /canvas-parameter-options quality/);
  assert.match(parameterEditor, /canvas-parameter-options resolution/);
  assert.match(parameterEditor, /canvas-parameter-options aspect/);
  assert.match(parameterEditor, /canvas-parameter-options count/);
  assert.match(parameterEditor, /\[1, 2, 3, 4, 5, 6, 7, 8\]\.map/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-trigger\{[^}]*min-height:38px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-trigger>span\{display:flex;align-items:baseline/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.aspect\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-drawer\{position:absolute;z-index:220/);
  assert.match(styles, /\.canvas-node-editor-popover:has\(\.canvas-parameter-drawer\)\{z-index:240;overflow:visible\}/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-drawer\{position:absolute;z-index:220[^}]*padding:9px;gap:7px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.aspect>button\{height:44px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.count\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:4px\}/);
  assert.match(styles, /data-density="compact"\]\{width:min\(500px/);
  assert.match(styles, /data-density="micro"\]\{width:min\(360px/);
  assert.match(styles, /data-density="micro"\]\{width:min\(360px,calc\(100vw - 24px\)\);max-height:min\(400px/);
});

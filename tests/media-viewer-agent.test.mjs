import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewer = await readFile(new URL("../components/MediaViewer.tsx", import.meta.url), "utf8");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");

test("media viewer keeps the requested top controls and removes repeated bottom actions", () => {
  for (const label of ["前后对比", "参数查看", "原图", "分享版", "关闭预览"]) {
    assert.ok(viewer.includes(label), `viewer should keep ${label}`);
  }
  assert.ok(viewer.includes("复制提示词"));
  assert.doesNotMatch(viewer, />保存提示词</);
  assert.doesNotMatch(viewer, /<textarea/);
  for (const label of ["反推提示词", "AI 优化", "编辑节点", "局部编辑", "超分", "继续生成", "作为参考图", "加入资产库", "删除"]) {
    assert.doesNotMatch(viewer, new RegExp(label));
  }
  assert.doesNotMatch(viewer, /className="canvas-media-viewer-actions/);
});

test("viewer parameter drawer exposes safe version metadata and keeps the overlay boundary rule", () => {
  assert.ok(viewer.includes("ImageVersionInfo"));
  assert.ok(viewer.includes("版本信息"));
  assert.ok(viewer.includes("来源节点"));
  assert.ok(viewer.includes("请求状态"));
  assert.ok(viewer.includes("生成持续时间"));
  assert.ok(viewer.includes("generationDurationMs"));
  assert.ok(viewer.includes('canvas-media-viewer-prompt-head'));
  assert.match(styles, /\.canvas-media-viewer-prompt\{display:grid;grid-template-columns:minmax\(0,1fr\);/);
  assert.doesNotMatch(viewer, /CreationParameterEditor/);
  assert.match(viewer, /event\.target === event\.currentTarget\) onClose\(\)/);
  assert.match(canvas, /versionInfo: mediaViewerVersionInfo\(document, viewerNode, runtime\)/);
  assert.match(canvas, /durationMs: generationDurationMs/);
  assert.match(canvas, /parameters: entries/);
});

test("Agent quick toolbar owns reverse prompting and writes the result back to agentPrompt", () => {
  const quickActionsStart = canvas.indexOf("const quickActions = useMemo");
  const quickActionsEnd = canvas.indexOf("// Below this threshold", quickActionsStart);
  assert.ok(quickActionsStart >= 0 && quickActionsEnd > quickActionsStart);
  const quickActions = canvas.slice(quickActionsStart, quickActionsEnd);
  assert.match(canvas, /const reverseAgentNodePrompt = useCallback/);
  assert.match(canvas, /runReversePrompt\(images/);
  assert.match(canvas, /agentPrompt: value/);
  assert.match(quickActions, /id: "reverse-prompt"/);
  assert.match(quickActions, /label: reverseAgentNodeId === node\.id \? "反推中…" : "反推提示词"/);
  assert.match(quickActions, /disabled: !hasImageReferences \|\| !chatModelsAvailable \|\| nodeBusy/);
  assert.match(canvas, /case "reverse-prompt":/);
});

test("viewer preview surfaces use project theme variables in both theme modes", () => {
  assert.doesNotMatch(styles, /\.media-viewer-shared \.media-viewer-stage[^}]*background:#0b0c10/);
  assert.match(styles, /\.media-viewer-shared \.media-viewer-stage[^}]*var\(--bg-2\)/);
  assert.match(styles, /\.canvas-media-version-facts>div[^}]*var\(--panel-2\)/);
  assert.match(styles, /@media\(max-width:720px\)\{\.canvas-media-version-facts\{grid-template-columns:1fr/);
});

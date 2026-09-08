import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const raster = await loadTypeScript("../lib/local-edit.ts");
const editor = await readFile(new URL("../components/MaskEditor.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../lib/creation/settings.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const viewer = await readFile(new URL("../components/MediaViewer.tsx", import.meta.url), "utf8");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");

test("brush and eraser preserve the mask alpha contract and coverage", () => {
  const pixels = raster.createProtectedMask(10, 10);
  raster.applyBrushMask(pixels, 10, 10, 5, 5, 2, "edit");
  const editedCoverage = raster.calculateEditableCoverage(pixels);
  assert.ok(editedCoverage > 0 && editedCoverage < 1);
  raster.applyBrushMask(pixels, 10, 10, 5, 5, 2, "protect");
  assert.equal(raster.calculateEditableCoverage(pixels), 0);
});

test("rectangle and ellipse selections add editable ranges", () => {
  const rectangle = raster.createProtectedMask(8, 6);
  raster.applyRectangleMask(rectangle, 8, 6, 1, 1, 5, 4);
  assert.equal(raster.calculateEditableCoverage(rectangle), 12 / 48);

  const ellipse = raster.createProtectedMask(8, 6);
  raster.applyEllipseMask(ellipse, 8, 6, 1, 1, 7, 5);
  const ellipseCoverage = raster.calculateEditableCoverage(ellipse);
  assert.ok(ellipseCoverage > 0 && ellipseCoverage < 1);
  raster.applyEllipseMask(ellipse, 8, 6, 1, 1, 7, 5, "protect");
  assert.equal(raster.calculateEditableCoverage(ellipse), 0);
});

test("point selection uses the current brush radius and stays normalized", () => {
  const point = {
    id: "point-1",
    kind: "point",
    description: "修改鞋子",
    geometry: { kind: "point", x: 0.5, y: 0.5, radius: 0.2 },
    createdAt: 1,
  };
  const pixels = raster.createProtectedMask(10, 10);
  raster.applyLocalEditAnnotationMask(pixels, 10, 10, point);
  assert.equal(pixels[(5 * 10 + 5) * 4 + 3], 0);
  assert.equal(pixels[3], 255);
  assert.ok(raster.calculateEditableCoverage(pixels) > 0);
});

test("multiple annotation types merge into one mask and empty descriptions remain valid", () => {
  const annotations = [
    {
      id: "rect",
      kind: "rectangle",
      description: "",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 0.25, height: 0.25 },
      createdAt: 1,
    },
    {
      id: "ellipse",
      kind: "ellipse",
      description: "替换背景文字",
      geometry: { kind: "ellipse", x: 0.5, y: 0.5, width: 0.4, height: 0.3 },
      createdAt: 2,
    },
  ];
  const merged = raster.rasterizeLocalEditAnnotations(20, 20, annotations);
  assert.equal(merged[(1 * 20 + 1) * 4 + 3], 0);
  assert.equal(merged[(13 * 20 + 14) * 4 + 3], 0);
  assert.ok(raster.calculateEditableCoverage(merged) > 0);
  assert.equal(raster.rasterizeLocalEditAnnotations(20, 20, annotations.filter((item) => item.id !== "rect"))[(1 * 20 + 1) * 4 + 3], 255);
});

test("smart provider pixels merge as an editable subject mask", () => {
  const smartPixels = raster.createProtectedMask(4, 4);
  smartPixels[(1 * 4 + 2) * 4 + 3] = 0;
  const annotation = {
    id: "smart-1",
    kind: "smart",
    description: "保留主体轮廓",
    geometry: { kind: "smart", x: 0.25, y: 0.25, width: 0.5, height: 0.5, maskDataUrl: "data:image/png;base64,test" },
    createdAt: 3,
  };
  const merged = raster.rasterizeLocalEditAnnotations(4, 4, [annotation], new Map([["smart-1", smartPixels]]));
  assert.equal(merged[(1 * 4 + 2) * 4 + 3], 0);
  assert.equal(merged[3], 255);
});

test("annotation descriptions compile once without duplicating the generated section", () => {
  const annotations = [
    { id: "one", kind: "point", description: "修改鞋子", geometry: { kind: "point", x: 0.2, y: 0.2, radius: 0.03 }, createdAt: 1 },
    { id: "two", kind: "point", description: "", geometry: { kind: "point", x: 0.4, y: 0.4, radius: 0.03 }, createdAt: 2 },
    { id: "three", kind: "point", description: "替换背景文字", geometry: { kind: "point", x: 0.6, y: 0.6, radius: 0.03 }, createdAt: 3 },
  ];
  const compiled = raster.compileLocalEditPrompt("整体保持自然", annotations);
  assert.match(compiled, /区域 1：修改鞋子/);
  assert.match(compiled, /区域 3：替换背景文字/);
  assert.doesNotMatch(compiled, /区域 2：/);
  assert.equal(raster.compileLocalEditPrompt(compiled, annotations), compiled);
  const unlabelled = raster.compileLocalEditPrompt("整体保持自然", [annotations[1]]);
  assert.doesNotMatch(unlabelled, /区域 1：/);
  assert.match(unlabelled, /局部处理要求：只修改编辑范围/);
  assert.match(raster.compileLocalEditPrompt("整体保持自然"), /局部处理要求：只修改编辑范围/);

  const moved = {
    id: "move-one",
    kind: "rectangle",
    description: "移动发光物体",
    geometry: { kind: "rectangle", x: 0.6, y: 0.2, width: 0.2, height: 0.2 },
    move: { from: [{ kind: "rectangle", x: 0.2, y: 0.2, width: 0.2, height: 0.2 }] },
    createdAt: 4,
  };
  const movePrompt = raster.compileLocalEditPrompt("保持主体、姿态和构图不变，只编辑指定范围。", [moved]);
  assert.doesNotMatch(movePrompt, /保持主体、姿态和构图不变/);
  assert.match(movePrompt, /不要移动选区外的人物、主体或画面构图/);
  const noBaseCompiled = raster.compileLocalEditPrompt("", [moved]);
  assert.equal(raster.compileLocalEditPrompt(noBaseCompiled, [moved]), noBaseCompiled);
  const legacyCompiled = "保持主体、姿态和构图不变，只编辑指定范围。\n\n局部区域说明：\n区域 1：以移动参考图中的剪贴结果为准，将圈选主体从原位置移到目标位置；仅修补原位置和目标边缘，保持选区外内容不变。";
  const migrated = raster.compileLocalEditPrompt(legacyCompiled, [moved]);
  assert.doesNotMatch(migrated, /以移动参考图中的剪贴结果为准|仅修补原位置和目标边缘/);
  assert.equal(raster.compileLocalEditPrompt(migrated, [moved]), migrated);
  assert.equal(raster.compileLocalEditPrompt(migrated.replace(/\n/g, "\r\n"), [moved]), migrated);
});

test("the workbench records complete operations, supports undo/redo, feather and empty-range blocking", () => {
  assert.match(editor, /while \(nextStates\.length > 21\) nextStates\.shift\(\)/);
  assert.match(editor, /pushHistory\(gesture\.before\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index - 1\)/);
  assert.match(editor, /restoreHistory\(historyRef\.current\.index \+ 1\)/);
  assert.match(editor, /const fusionFeather = localEditFusionFeather\(feather\)/);
  assert.match(editor, /createSeamlessLocalEditMask\(sourcePixels, source\.width, source\.height, fusionFeather\)/);
  assert.match(editor, /exported\.feather/);
  assert.doesNotMatch(editor, /outputContext\.filter = `blur\(\$\{feather\}px\)`/);
  assert.match(editor, /drawMaskOverlay\(mask, overlay, localEditFusionFeather\(feather\)\)/);
  assert.match(editor, /Math\.max\(0\.2, Math\.min\(3/);
  assert.match(editor, /const scale = Math\.min\(availableWidth \/ canvas\.width, availableHeight \/ canvas\.height\)/);
  assert.match(editor, /onClick=\{fitCanvas\}/);
  assert.match(editor, /请先指定编辑区域，再应用局部编辑/);
  assert.match(editor, /const exported = exportMask\(\);[\s\S]*exported\.coverage <= 0/);
  assert.doesNotMatch(editor, /disabled=\{[^}]*coverage <= 0/);
  assert.match(editor, /disabled=\{!ready \|\| saving \|\| Boolean\(pendingAnnotation\) \|\| Boolean\(movingAnnotation\)/);
});

test("local edit history shortcuts use physical keys and are not preempted by canvas shortcuts", () => {
  assert.match(editor, /const isUndoKey = key === 'z' \|\| event\.code === 'KeyZ'/);
  assert.match(editor, /const isRedoKey = key === 'y' \|\| event\.code === 'KeyY'/);
  assert.match(editor, /!event\.repeat && \(event\.ctrlKey \|\| event\.metaKey\) && isUndoKey/);
  assert.match(canvas, /if \(maskNodeId\) return;\s*if \(isEditableTarget\(event\.target\)\) return;/);
});

test("completed marks stay editable without opening a text dialog", () => {
  assert.match(editor, /function setAnnotationPending\(annotation: LocalEditAnnotation, before: HistorySnapshot/);
  assert.match(editor, /stage: 'modify'/);
  assert.match(editor, /isExisting: true/);
  assert.match(editor, /function saveEditedAnnotation\(\)/);
  assert.match(editor, /function annotationPreviewStyle\(annotation: LocalEditAnnotation, imageUrl: string\)/);
  assert.match(editor, /className="local-edit-selection-thumb"/);
  assert.match(editor, /<button type="button" onClick=\{\(\) => editAnnotation\(annotation\)\}>修改<\/button>/);
  assert.match(styles, /\.local-edit-selection-thumb\{[^}]*background-repeat:no-repeat/);
});

test("pixel feathering creates a real alpha transition around an editable region", () => {
  const mask = raster.createProtectedMask(21, 21);
  raster.applyRectangleMask(mask, 21, 21, 5, 5, 16, 16);
  const unchanged = raster.featherLocalEditMask(mask, 21, 21, 0);
  assert.deepEqual([...unchanged], [...mask]);

  const feathered = raster.featherLocalEditMask(mask, 21, 21, 2);
  const alphaAt = (x, y) => feathered[(y * 21 + x) * 4 + 3];
  assert.equal(alphaAt(10, 10), 0);
  assert.ok(alphaAt(4, 10) > 0 && alphaAt(4, 10) < 255);
  assert.equal(alphaAt(2, 10), 255);
  assert.equal(alphaAt(10, 10) < alphaAt(4, 10), true);
});

test("submitted masks expand both edit locations and keep a minimum fusion transition", () => {
  const mask = raster.createProtectedMask(21, 21);
  raster.applyRectangleMask(mask, 21, 21, 5, 5, 10, 16);
  raster.applyRectangleMask(mask, 21, 21, 12, 5, 17, 16);
  const alphaAt = (pixels, x, y) => pixels[(y * 21 + x) * 4 + 3];

  const expanded = raster.expandLocalEditMask(mask, 21, 21, 1);
  assert.equal(alphaAt(expanded, 4, 10), 0);
  assert.equal(alphaAt(expanded, 11, 10), 0);

  const seamless = raster.createSeamlessLocalEditMask(mask, 21, 21, 0);
  assert.equal(raster.localEditFusionFeather(0), 2);
  assert.equal(alphaAt(seamless, 7, 10), 0);
  assert.equal(alphaAt(seamless, 14, 10), 0);
  assert.ok(alphaAt(seamless, 3, 10) > 0 && alphaAt(seamless, 3, 10) < 255);
  assert.ok(alphaAt(seamless, 18, 10) > 0 && alphaAt(seamless, 18, 10) < 255);
});

test("moving a selection masks both source and target while compiling a visual-guide prompt", () => {
  const source = Uint8ClampedArray.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  const originalSource = new Uint8ClampedArray(source);
  const sourceGeometry = { kind: "rectangle", x: 0.1, y: 0.25, width: 0.2, height: 0.5 };
  const targetGeometry = { kind: "rectangle", x: 0.6, y: 0.25, width: 0.2, height: 0.5 };
  const moved = {
    id: "moved",
    kind: "rectangle",
    description: "把物体移到右侧",
    geometry: targetGeometry,
    move: { from: [sourceGeometry] },
    createdAt: 1,
  };
  const mask = raster.rasterizeLocalEditAnnotations(10, 4, [moved]);
  assert.equal(mask[(1 * 10 + 1) * 4 + 3], 0);
  assert.equal(mask[(1 * 10 + 6) * 4 + 3], 0);
  assert.equal(mask[(1 * 10 + 4) * 4 + 3], 255);
  assert.deepEqual([...source], [...originalSource]);

  const repeated = {
    ...moved,
    geometry: { kind: "rectangle", x: 0.8, y: 0.25, width: 0.2, height: 0.5 },
    move: { from: [sourceGeometry, targetGeometry] },
  };
  const repeatedMask = raster.rasterizeLocalEditAnnotations(10, 4, [repeated]);
  assert.equal(repeatedMask[(1 * 10 + 1) * 4 + 3], 0);
  assert.equal(repeatedMask[(1 * 10 + 6) * 4 + 3], 0);
  assert.equal(repeatedMask[(1 * 10 + 8) * 4 + 3], 0);
  const compiled = raster.compileLocalEditPrompt("保持光影自然", [moved]);
  assert.match(compiled, /移动参考图已经标出最终摆放/);
  assert.match(compiled, /将圈选物体完整迁移到目标位置/);
  assert.match(compiled, /不要移动选区外的人物、主体或画面构图/);
  assert.match(compiled, /透明洞或拼接痕迹/);
  assert.doesNotMatch(compiled, /移动方向/);
  assert.match(compiled, /补充说明：把物体移到右侧/);
});

test("moving a selection repairs the source, pastes the selected pixels, and keeps the guide opaque", () => {
  const source = Uint8ClampedArray.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  const original = new Uint8ClampedArray(source);
  const selection = raster.createProtectedMask(4, 1);
  selection[7] = 0;
  const moved = raster.moveLocalEditPixels(source, selection, 4, 1, 2, 0);
  assert.deepEqual([...source], [...original]);
  for (let index = 3; index < moved.length; index += 4) assert.equal(moved[index], 255);
  assert.notDeepEqual([...moved.subarray(4, 8)], [...source.subarray(4, 8)]);
  assert.deepEqual([...moved.subarray(12, 16)], [0, 255, 0, 255]);

  const secondSelection = raster.createProtectedMask(4, 1);
  secondSelection[15] = 0;
  const movedAgain = raster.moveLocalEditPixels(moved, secondSelection, 4, 1, -2, 0);
  assert.deepEqual([...movedAgain.subarray(4, 8)], [0, 255, 0, 255]);
  assert.notDeepEqual([...movedAgain.subarray(12, 16)], [0, 255, 0, 255]);
  for (let index = 3; index < movedAgain.length; index += 4) assert.equal(movedAgain[index], 255);
});

test("move preview and provider guide remove the source while preserving an opaque blended target cue", () => {
  const source = Uint8ClampedArray.from([
    1, 0, 0, 255,
    2, 0, 0, 255,
    3, 0, 0, 255,
    4, 0, 0, 255,
    5, 0, 0, 255,
    6, 0, 0, 255,
    7, 0, 0, 255,
    8, 0, 0, 255,
    9, 0, 0, 255,
    10, 0, 0, 255,
  ]);
  const original = new Uint8ClampedArray(source);
  const rectangle = (x) => ({ kind: "rectangle", x, y: 0, width: 0.1, height: 1 });
  const smartSource = raster.createProtectedMask(10, 1);
  smartSource[(3 * 4) + 3] = 0;
  const annotations = [
    {
      id: "repeat",
      kind: "rectangle",
      description: "",
      geometry: rectangle(0.6),
      move: { from: [rectangle(0.1), rectangle(0.4)] },
      createdAt: 1,
    },
    {
      id: "smart",
      kind: "smart",
      description: "",
      geometry: { kind: "smart", x: 0.8, y: 0, width: 0.1, height: 1 },
      move: { from: [{ kind: "smart", x: 0.3, y: 0, width: 0.1, height: 1 }] },
      createdAt: 2,
    },
  ];
  const smartMasks = new Map([["smart:from:0", smartSource]]);
  const preview = raster.composeLocalEditMovePreview(source, 10, 1, annotations, smartMasks);
  const reference = raster.composeLocalEditMoveReference(source, 10, 1, annotations, smartMasks);

  assert.deepEqual([...source], [...original]);
  assert.deepEqual([...preview], [...reference]);
  for (let index = 3; index < reference.length; index += 4) assert.equal(reference[index], 255);
  assert.notDeepEqual([...reference.subarray(4, 8)], [...source.subarray(4, 8)]);
  assert.notDeepEqual([...reference.subarray(12, 16)], [...source.subarray(12, 16)]);
  assert.notEqual(reference[24], source[24]);
  assert.notEqual(reference[32], source[32]);

  const repeatedOnly = raster.composeLocalEditMoveReference(source, 10, 1, [annotations[0]]);
  assert.notEqual(repeatedOnly[1 * 4], source[1 * 4]);
  assert.notEqual(repeatedOnly[4 * 4], source[4 * 4]);
  assert.notEqual(repeatedOnly[6 * 4], source[6 * 4]);
});

test("moving a smart selection masks its original and translated smart pixels", () => {
  const sourceSmart = raster.createProtectedMask(6, 4);
  sourceSmart[(1 * 6 + 1) * 4 + 3] = 0;
  const targetSmart = raster.createProtectedMask(6, 4);
  targetSmart[(1 * 6 + 4) * 4 + 3] = 0;
  const annotation = {
    id: "smart-move",
    kind: "smart",
    description: "修改智能主体",
    geometry: { kind: "smart", x: 0.66, y: 0.25, width: 0.17, height: 0.25, maskDataUrl: "data:image/png;base64,target" },
    move: { from: [{ kind: "smart", x: 0.16, y: 0.25, width: 0.17, height: 0.25, maskDataUrl: "data:image/png;base64,source" }] },
    createdAt: 1,
  };
  const masks = new Map([
    ["smart-move", targetSmart],
    ["smart-move:from:0", sourceSmart],
  ]);
  const merged = raster.rasterizeLocalEditAnnotations(6, 4, [annotation], masks);
  assert.equal(merged[(1 * 6 + 1) * 4 + 3], 0);
  assert.equal(merged[(1 * 6 + 4) * 4 + 3], 0);
  assert.equal(merged[(1 * 6 + 2) * 4 + 3], 255);
});

test("local edit exposes reliable pointer tools, free lasso selection, and a fixed no-scroll workbench", () => {
  assert.match(editor, /type LocalEditTool = 'brush' \| 'eraser' \| 'rectangle' \| 'ellipse' \| 'lasso' \| 'point' \| 'smart' \| 'pan'/);
  assert.match(editor, /function drawLasso\(context: CanvasRenderingContext2D, path: Point\[\]\)/);
  assert.match(editor, /function radiusFor\(\)/);
  assert.match(editor, /return Math\.max\(1, brushSize \/ 2\);/);
  assert.doesNotMatch(editor, /getBoundingClientRect\(\).*brushSize/);
  assert.match(editor, /function formatCoverage\(value: number\)/);
  assert.match(editor, /return '<0\.1%';/);
  assert.match(editor, /percent\.toFixed\(1\)/);
  assert.match(editor, /event\.preventDefault\(\);/);
  assert.match(editor, /onLostPointerCapture=\{handleLostPointerCapture\}/);
  assert.match(editor, /context\.clearRect\(0, 0, canvas\.width, canvas\.height\);/);
  assert.match(editor, /onApply: \(maskDataUrl: string, coverage: number, prompt: string, annotations: LocalEditAnnotation\[\], feather: number, moveGuideDataUrl\?: string\)/);
  assert.match(editor, /initialPrompt\?: string/);
  assert.match(editor, /const \[prompt, setPrompt\] = useState\(''\)/);
  assert.doesNotMatch(editor, /setPrompt\(initialPrompt\)/);
  assert.doesNotMatch(editor, /请填写局部编辑提示词/);
  assert.match(editor, /局部编辑补充说明（可选）/);
  assert.match(editor, /可选：补充本次局部编辑要移除、替换或添加的内容…/);
  assert.match(editor, /initialFeather\?: number/);
  assert.match(editor, /localEditFusionFeather\(feather\)/);
  assert.match(editor, /function beginMoveAnnotation/);
  assert.match(editor, /function beginPendingMove/);
  assert.match(editor, /dragImage: copyImageData\(dragBefore\.image\)/);
  assert.match(editor, /isPendingDraft: true/);
  assert.match(editor, /setPendingAnnotation\(pending\)/);
  assert.match(editor, /rebuildMask\(annotationsWithPending\(pending\)\)/);
  assert.match(editor, /nextFrom = movingAnnotation\.isPendingDraft/);
  assert.match(editor, /!movingAnnotation\.isPendingDraft/);
  assert.match(editor, /type LocalEditMode = 'modify' \| 'move'/);
  assert.match(editor, /aria-label="局部编辑功能"/);
  assert.match(editor, /圈选要移动的物体，再拖到目标位置，并补充移动要求/);
  assert.match(editor, /圈选要修改的区域，并补充要移除、替换或添加的内容/);
  assert.match(editor, /placeholder=\{mode === 'move' \? '补充移动说明' : '补充修改说明'\}/);
  assert.match(editor, /aria-label=\{mode === 'move' \? '移动说明' : '修改说明'\}/);
  assert.match(editor, /strong>\{mode === 'move' \? '移动说明' : '修改说明'\}<\/strong>/);
  assert.match(editor, /mode === 'move'\) beginMoveAnnotation\(event, annotation\)/);
  assert.match(editor, /className=\{`local-edit-annotation\$\{mode === 'move' \? ' move-enabled' : ''\}/);
  assert.match(editor, /local-edit-operation-card/);
  assert.match(editor, /setMoveSourceId\(annotation\.id\)/);
  assert.match(editor, /local-edit-move-frame target/);
  assert.match(editor, /onPointerDown=\{pendingMove \? \(event\) => beginPendingMove\(event, pendingMove\) : undefined\}/);
  assert.match(editor, /x1=\{`\$\{source\.x \* 100\}%`\} y1=\{`\$\{source\.y \* 100\}%`\} x2=\{`\$\{target\.x \* 100\}%`\} y2=\{`\$\{target\.y \* 100\}%`\}/);
  assert.match(editor, /x1=\{`\$\{\(source\.x \+ source\.width\) \* 100\}%`\}/);
  assert.match(editor, /move: \{ from:/);
  assert.match(editor, /取消移动/);
  assert.match(editor, /moveLocalEditPixels\(/);
  assert.match(editor, /composeLocalEditMovePreview\(/);
  assert.match(editor, /composeLocalEditMoveReference\(/);
  assert.match(editor, /function exportMoveGuideImage\(\)/);
  assert.match(editor, /const source = sourceImageRef\.current/);
  assert.match(editor, /createSeamlessLocalEditMask\(/);
  assert.match(editor, /原位置 · 待修补/);
  assert.match(editor, /function deleteAnnotation/);
  assert.match(editor, /补充.*说明/);
  assert.match(styles, /\.local-edit-workbench\{[^}]*height:min\(900px,calc\(100vh - 24px\)\);[^}]*overflow:hidden/);
  assert.match(styles, /\.local-edit-workbench-body\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(260px,320px\)/);
  assert.match(styles, /\.local-edit-move-frame\.target[^}]*pointer-events:auto/);
  assert.doesNotMatch(styles, /marker-end:url\(#local-edit-move-arrow\)/);
});

test("local edit shortcuts append prompts without submitting automatically", () => {
  assert.match(editor, /LOCAL_EDIT_INTENTS/);
  assert.match(editor, /移除物体/);
  assert.match(editor, /替换区域/);
  assert.match(editor, /添加元素/);
  assert.match(editor, /保持主体/);
  assert.match(editor, /const promptForMode = mode === 'move' && intent === 'subject'/);
  assert.match(editor, /existing \? `\$\{existing\}\\n\$\{promptForMode\}` : promptForMode/);
  assert.match(editor, /应用局部编辑/);
});

test("all image entry points use local edit wording while persisted field remains mask", () => {
  for (const source of [editor, page, viewer, canvas]) {
    assert.doesNotMatch(source, /绘制蒙版|查看蒙版|应用蒙版|蒙版已设置|本次使用蒙版/);
  }
  assert.match(page, /LocalEditEditor/);
  assert.match(viewer, /onLocalEdit/);
  assert.match(canvas, /onLocalEdit/);
  assert.match(settings, /const maskRaw = typeof raw\.mask === "string"[\s\S]*objectValue\(raw\.mask\)/);
  assert.match(editor, /initialMaskDataUrl/);
  assert.match(page, /const legacySavedMask = item\?\.params\?\.mask \|\| item\?\.mask/);
  assert.match(page, /const restoredMask = typeof legacySavedMask === 'string'/);
  assert.match(page, /mask: currentEditor\.mask \|\| undefined/);
  assert.match(page, /annotations: currentEditor\.mode === 'edit'/);
  assert.match(page, /onApply: \(dataUrl, coverage, prompt, annotations, feather, moveGuideDataUrl\)=>/);
  assert.match(page, /\.\.\.\(moveGuideDataUrl \? \{ sourceImageDataUrl: moveGuideDataUrl \} : \{\}\)/);
  assert.match(page, /sourceImageDataUrl: moveGuideDataUrl \|\| undefined/);
  assert.match(canvas, /initialAnnotations=/);
  assert.match(canvas, /annotations\.length \? \{ annotations \} : \{\}/);
});

test("local edit model selection is restricted to edit-capable image models and videos remain separate", () => {
  assert.match(settings, /export function imageEditModelOptions/);
  assert.match(settings, /settings\.mask\s*\n\s*\? imageEditModelOptions\(runtime\)/);
  assert.match(page, /generateMask && availableEditModels\.length \? availableEditModels : availableGenerationModels/);
  assert.match(page, /capability: generateMask && availableEditModels\.length \? "edit" : "generate"/);
  assert.match(canvas, /kind === "video"/);
  assert.doesNotMatch(editor, /video/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const director = await importTypeScript("../lib/cinematic-shock-opening-director.ts");
const cinematicPanel = await readFile(
  new URL("../components/canvas/OneClickCinematicPanel.tsx", import.meta.url),
  "utf8",
);
const superCanvas = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const canvasCss = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");

test("cinematic director keeps the default duration at eight seconds", () => {
  assert.equal(director.resolvedCinematicDuration("auto"), 8);
  assert.equal(director.resolvedCinematicDuration(15), 15);
  assert.match(director.buildCinematicDirectorInstructions(), /SURPRISE MOMENT/);
  assert.match(director.buildCinematicDirectorInstructions(), /videoPrompt/);
});

test("parses fenced director JSON and compiles a protected video prompt", () => {
  const plan = director.parseCinematicDirectorPlan(`\n\`\`\`json
{"concept":{"title":"反射穿越","visualIdea":"从金属高光穿入主体"},"directingMode":"one_take","shots":[{"start":0,"end":1,"camera":"贴近高光快速掠过"}],"surpriseMoment":"倒影突然变成真实主体","heroEnding":"减速后英雄定格","videoPrompt":"高级商业广告镜头，从参考图的金属高光开始。","negativePrompt":"不要改变产品结构、Logo 和文字。","analysis":{"preserve":["产品结构","Logo"]}}
\`\`\``);
  const prompt = director.compileCinematicVideoPrompt(plan, {
    duration: "auto",
    wowLevel: 4,
    directingMode: "auto",
    aspectRatio: "project",
    creativity: "balanced",
    userDirection: "不要改变人物表情",
  }, {
    kind: "video",
    model: "auto",
    operation: "generate",
    inputMode: "first-frame",
    duration: 8,
    aspect: "16:9",
    resolution: "720p",
    audio: false,
    agnesWidth: 1152,
    agnesHeight: 768,
    agnesNumFrames: 81,
    agnesFrameRate: 24,
  });
  assert.match(prompt, /从参考图的金属高光开始/);
  assert.match(prompt, /产品结构、Logo/);
  assert.match(prompt, /不要改变人物表情/);
  assert.match(prompt, /0–1s/);
});

test("rejects a director response without an executable prompt", () => {
  assert.throws(() => director.parseCinematicDirectorPlan('{"concept":{}}'), /无法解析|可执行/);
});

test("one-click cinematic requires an explicit provider and video model", () => {
  assert.match(cinematicPanel, /videoModelOptions\(runtime\)/);
  assert.match(cinematicPanel, /请选择服务商/);
  assert.match(cinematicPanel, /请选择视频模型/);
  assert.match(cinematicPanel, /disabled=\{!selectedModel\}/);
  assert.match(cinematicPanel, /providerId: selectedModel\.providerId/);
  assert.match(cinematicPanel, /modelId: selectedModel\.id/);

  const runStart = superCanvas.indexOf("const runOneClickCinematic = useCallback");
  const runEnd = superCanvas.indexOf("const editorPromptFor", runStart);
  assert.ok(runStart >= 0 && runEnd > runStart);
  const runSource = superCanvas.slice(runStart, runEnd);
  assert.match(superCanvas, /runtime=\{runtime\}/);
  assert.match(superCanvas, /runOneClickCinematic\(source, settings, selection\)/);
  assert.match(runSource, /model: selectedModel\.id/);
  assert.doesNotMatch(runSource, /model: resolvedModel\.model\?\.id \|\| "auto"/);
});

test("one-click cinematic keeps its footer inside a constrained dialog", () => {
  assert.match(canvasCss, /\.canvas-one-click-dialog\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(canvasCss, /\.canvas-one-click-body\{[^}]*overflow-y:auto/);
  assert.match(canvasCss, /\.canvas-one-click-footer\{[^}]*flex-wrap:wrap/);
  assert.match(canvasCss, /\.canvas-one-click-footer button\{[^}]*max-width:100%/);
});

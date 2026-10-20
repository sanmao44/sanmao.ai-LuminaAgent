import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadImageReferenceRequest() {
  const referencesUrl = new URL("../lib/creative-references.ts", import.meta.url);
  const referencesSource = await readFile(referencesUrl, "utf8");
  const referencesCompiled = ts.transpileModule(referencesSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: referencesUrl.pathname,
  }).outputText;
  const referencesModuleUrl = `data:text/javascript;base64,${Buffer.from(referencesCompiled).toString("base64")}`;
  const requestUrl = new URL("../lib/canvas/image-reference-request.ts", import.meta.url);
  const requestSource = await readFile(requestUrl, "utf8");
  const requestCompiled = ts.transpileModule(requestSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: requestUrl.pathname,
  }).outputText
    .replace('from "../creative-references"', `from "${referencesModuleUrl}"`)
    .replace('import { MAX_IMAGE_REFERENCES } from "@/packages/contracts/creative";', 'const MAX_IMAGE_REFERENCES = 16;');
  return import(`data:text/javascript;base64,${Buffer.from(requestCompiled).toString("base64")}`);
}

const sourceUrl = new URL("../lib/canvas/variant-generation.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace(/^import[\s\S]*?;\r?\n/gm, "");
const imageReferenceRequest = await loadImageReferenceRequest();
globalThis.__prepareCanvasImageReferenceRequest = imageReferenceRequest.prepareCanvasImageReferenceRequest;
globalThis.__canvasImageRequestOperation = imageReferenceRequest.canvasImageRequestOperation;
const variantBatchUrl = new URL("../lib/canvas/variant-batch.ts", import.meta.url);
const variantBatchSource = `const canvasImageRequestOperation = globalThis.__canvasImageRequestOperation;\n${(await readFile(variantBatchUrl, "utf8"))
  .replace(/^import[\s\S]*?;\r?\n/gm, "")}`;
const variantBatchCompiled = ts.transpileModule(variantBatchSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: variantBatchUrl.pathname,
}).outputText;
const variantBatch = await import(`data:text/javascript;base64,${Buffer.from(variantBatchCompiled).toString("base64")}`);
const stubs = String.raw`function incomingContext(document, entityId) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges.filter((edge) => edge.target === entityId).map((edge) => nodes.get(edge.source)).filter(Boolean);
}
function isCanvasReferenceableNode(node) { return Boolean(node && (node.type === "media" || node.type === "upscale") && node.data.kind && node.data.url); }
function isCanvasMentionableNode(node) { return Boolean(node && (node.type === "prompt" || node.type === "generator" || isCanvasReferenceableNode(node))); }
function smartPrompt(prompt, context) { return [prompt.trim(), ...context.filter((node) => node.type === "prompt").map((node) => String(node.data.text || "").trim()).filter(Boolean)].filter(Boolean).join("\n"); }
function createCanvasReferenceDraft(node) {
  if (node.type === "prompt") return { id: "node-ref:" + node.id, nodeId: node.id, kind: "text", text: String(node.data.text || ""), name: "text", origin: "node" };
  if (node.type === "generator") return { id: "node-ref:" + node.id, nodeId: node.id, kind: "text", text: String(node.data.prompt || ""), name: "prompt", origin: "node" };
  if (!isCanvasReferenceableNode(node)) return null;
  return { id: "node-ref:" + node.id, nodeId: node.id, kind: node.data.kind, url: String(node.data.url), name: String(node.data.name || "asset"), width: Number(node.data.nativeWidth) || undefined, height: Number(node.data.nativeHeight) || undefined, origin: "node" };
}
function prepareCanvasImageReferenceRequest(input) { return globalThis.__prepareCanvasImageReferenceRequest(input); }
function canvasImageRequestOperation(params) { return globalThis.__canvasImageRequestOperation(params); }
function resolveCanvasMentionTokens(prompt) { return prompt.replace(/@([0-9]+)/g, (_, number) => "reference" + number); }
function replaceNaturalReferenceLabels(value, references) { return { value: value.replace(/(?:Image|image)\s*(\d+)/g, "@$1"), replaced: false, unresolved: [] }; }
function selectCreativeReferences(value, available) {
  const numbers = [...value.matchAll(/@([0-9]+)/g)].map((match) => Number(match[1]));
  const invalidNumbers = [...new Set(numbers.filter((number) => number < 1 || number > available.length))];
  const hasMentions = numbers.length > 0;
  return { references: hasMentions ? numbers.filter((number) => number >= 1 && number <= available.length).map((number) => available[number - 1]) : [...available], invalidNumbers, hasMentions };
}
`;
const compiled = ts.transpileModule(stubs + source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const generation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("prepares variant prompts and selected references without mutating inputs", () => {
  const prompt = { id: "prompt-1", type: "prompt", x: 0, y: 0, data: { text: "context" } };
  const image = { id: "image-1", type: "media", x: 20, y: 0, data: { kind: "image", url: "/image.png", name: "hero" } };
  const generator = { id: "generator-1", type: "generator", x: 100, y: 0, data: { prompt: "create scene" } };
  const document = { version: "test", nodes: [prompt, image, generator], edges: [{ id: "edge-1", source: "image-1", target: "generator-1", kind: "reference" }, { id: "edge-2", source: "prompt-1", target: "generator-1", kind: "context" }], groups: [], camera: { x: 0, y: 0, zoom: 1 } };
  const requirements = ["wide shot", "close shot"];
  const result = generation.prepareCanvasVariantGeneration({ document, generator, requirements, mentionCandidates: [] });
  assert.deepEqual(result.linkedNodes.map((node) => node.id), ["image-1"]);
  assert.deepEqual(result.imageReferences, [{ url: "/image.png", name: "hero" }]);
  assert.equal(result.prompts.length, 2);
  assert.equal(typeof result.prompts[0], "string");
  assert.deepEqual(requirements, ["wide shot", "close shot"]);

  const mentioned = generation.prepareCanvasVariantGeneration({
    document,
    generator: { ...generator, data: { prompt: "use Image 1" } },
    requirements,
    mentionCandidates: [],
  });
  assert.deepEqual(mentioned.linkedNodes.map((node) => node.id), ["image-1"]);
});

test("prepares each image variant with its own visual refs and layout ratio", () => {
  const ratio = { id: "ratio", type: "media", x: 0, y: 0, data: { kind: "image", url: "/ratio.png", name: "layout", nativeWidth: 2400, nativeHeight: 600 } };
  const style = { id: "style", type: "media", x: 20, y: 0, data: { kind: "image", url: "/style.png", name: "style", nativeWidth: 1200, nativeHeight: 1200 } };
  const generator = { id: "generator-2", type: "generator", x: 100, y: 0, data: { prompt: "生成山东主题新图" } };
  const params = {
    kind: "image",
    model: "image-model",
    aspect: "自动",
    customAspectWidth: 1,
    customAspectHeight: 1,
    sizeMode: "system",
    resolution: "2K",
    width: 1024,
    height: 1024,
    count: 1,
    quality: "自动",
    outputFormat: "png",
    backgroundMode: "auto",
    upscaleScale: 2,
    upscaleTarget: "auto",
    upscaleSeed: 1,
    upscaleColorCorrection: "wavelet",
    upscaleAlgorithm: "lanczos",
  };
  const prepared = generation.prepareCanvasVariantGeneration({
    document: { version: "test", nodes: [ratio, style, generator], edges: [], groups: [], camera: { x: 0, y: 0, zoom: 1 } },
    generator,
    requirements: ["仅将 @1 用于比例，采用 @2 风格", "只采用 @2 风格"],
    mentionCandidates: [ratio, style],
    imageParams: params,
  });

  assert.equal(prepared.imageRequests.length, 2);
  const [wide, square] = prepared.imageRequests;
  assert.equal(wide.ok, true);
  assert.equal(square.ok, true);
  if (!wide.ok || !square.ok) return;
  assert.deepEqual(wide.references.map((reference) => reference.nodeId), ["style"]);
  assert.equal(wide.imageOperation, "auto");
  assert.deepEqual(wide.imageReferences.map((reference) => reference.url), ["/style.png"]);
  assert.ok(Math.abs(wide.params.customAspectWidth / wide.params.customAspectHeight - 4) < 0.005);
  assert.doesNotMatch(wide.prompt, /@1|@2/);
  assert.deepEqual(square.references.map((reference) => reference.nodeId), ["style"]);
  assert.equal(square.imageOperation, "auto");
  assert.deepEqual(square.imageReferences.map((reference) => reference.url), ["/style.png"]);
  assert.equal(square.params.aspect, "自动");
});

test("keeps masked image variants on the edit operation", () => {
  const base = {
    taskId: "task-1",
    prompt: "修改选区",
    params: {
      kind: "image",
      model: "image-model",
      aspect: "1:1",
      customAspectWidth: 1,
      customAspectHeight: 1,
      sizeMode: "system",
      resolution: "2K",
      count: 1,
      quality: "自动",
      outputFormat: "png",
      backgroundMode: "auto",
      upscaleScale: 2,
      upscaleTarget: "auto",
      upscaleSeed: 1,
      upscaleColorCorrection: "wavelet",
      upscaleAlgorithm: "lanczos",
      mask: { url: "data:image/png;base64,mask", sourceUrl: "data:image/png;base64,guide" },
    },
    references: [{ url: "data:image/png;base64,source", name: "source" }],
  };

  const request = variantBatch.canvasVariantImageRequest(base);
  assert.equal(request.imageOperation, "edit");
  assert.equal(request.maskUrl, base.params.mask.url);
  assert.equal(request.moveGuideUrl, base.params.mask.sourceUrl);
});

test("unmasked canvas images defer semantic operation choice while masks remain explicit edits", () => {
  assert.equal(
    imageReferenceRequest.canvasImageRequestOperation({}, { useCurrentImageAsReference: true }),
    "auto",
  );
  assert.equal(
    imageReferenceRequest.canvasImageRequestOperation({
      mask: { url: "data:image/png;base64,mask", sourceUrl: "data:image/png;base64,source" },
    }, { useCurrentImageAsReference: false }),
    "auto",
  );
  assert.equal(
    imageReferenceRequest.canvasImageRequestOperation({
      mask: { url: "data:image/png;base64,mask", sourceUrl: "data:image/png;base64,source" },
    }),
    "edit",
  );
});

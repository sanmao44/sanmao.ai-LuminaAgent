import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/variant-generation.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace(/^import[\s\S]*?;\r?\n/gm, "");
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
  return { id: "node-ref:" + node.id, nodeId: node.id, kind: node.data.kind, url: String(node.data.url), name: String(node.data.name || "asset"), origin: "node" };
}
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

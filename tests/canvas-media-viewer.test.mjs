import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/media-viewer.ts", import.meta.url);
let source = await readFile(sourceUrl, "utf8");
source = source
  .replace(/import \{ comparisonReferences, isCanvasReferenceableNode, nodeById \} from [^\n]+;\r?\n/, "const comparisonReferences = (document, entityId) => document.nodes.filter((node) => node.id !== entityId && node.type === \"media\" && node.data?.kind === \"image\" && node.data?.url); const isCanvasReferenceableNode = (node) => Boolean(node && (node.type === \"media\" || node.type === \"upscale\") && node.data?.kind && node.data?.url); const nodeById = (document, id) => document.nodes.find((node) => node.id === id);\n")
  .replace(/import \{ nodeLabel \} from [^\n]+;\r?\n/, "const nodeLabel = (node) => `node:${node.id}`;\n");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const mediaViewer = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

function node(overrides = {}) {
  return {
    id: "output-1",
    type: "media",
    x: 0,
    y: 0,
    data: {
      kind: "image",
      url: "https://example.test/output.png",
      nativeWidth: 1024,
      nativeHeight: 768,
      status: "completed",
      generation: {
        prompt: "a generated image",
        createdAt: 1700000000000,
        durationMs: 1234,
        parentNodeId: "source-1",
        referenceIds: ["source-1"],
        params: {
          aspect: "自定义",
          customAspectWidth: 4,
          customAspectHeight: 3,
          resolution: "2K",
          operation: "edit",
          inputMode: "reference",
          duration: 4,
          sizeMode: "custom",
          width: 800,
          height: 600,
          mask: { enabled: true },
          model: "model-id",
        },
      },
      providerName: "Provider",
      model: "Model Display",
    },
    ...overrides,
  };
}

const sourceNode = {
  id: "source-1",
  type: "prompt",
  x: 0,
  y: 0,
  data: { text: "source", name: "Source name" },
};
const document = { nodes: [sourceNode, node()], edges: [], groups: [] };
const runtime = { models: [{ id: "model-id", displayName: "Runtime model", providerName: "Runtime provider" }] };

test("media viewer metadata projects generation, source and runtime model details", () => {
  const info = mediaViewer.mediaViewerVersionInfo(document, node(), runtime);
  assert.equal(info.sourceNode, "node:source-1 · Source name");
  assert.equal(info.provider, "Provider");
  assert.equal(info.model, "Model Display · model-id");
  assert.equal(info.dimensions, "1024 × 768");
  assert.equal(info.prompt, "a generated image");
  assert.equal(info.status, "已完成");
  assert.equal(info.createdAt, 1700000000000);
  assert.equal(info.generationDurationMs, 1234);
  assert.deepEqual(info.parameters, [
    { label: "比例", value: "4:3" },
    { label: "分辨率", value: "2K" },
    { label: "尺寸", value: "800 × 600" },
    { label: "操作", value: "编辑" },
    { label: "输入", value: "参考图" },
    { label: "时长", value: "4 秒" },
    { label: "参考", value: "1 项" },
    { label: "局部编辑", value: "已启用" },
  ]);
});

test("canvas node projection keeps the existing viewer item and comparison reference shape", () => {
  const sourceImage = { id: "source-image", type: "media", x: 0, y: 0, data: { kind: "image", url: "/source.png", name: "Source image" } };
  const output = node({ data: { ...node().data, generation: { ...node().data.generation, parentNodeId: "source-image" } } });
  const projectionDocument = { nodes: [sourceImage, output], groups: [], edges: [] };
  const item = mediaViewer.mediaViewerItemForCanvasNode(projectionDocument, output, null);
  assert.equal(item.id, "output-1");
  assert.equal(item.kind, "image");
  assert.equal(item.url, "https://example.test/output.png");
  assert.equal(item.name, "画布素材");
  assert.equal(item.width, 1024);
  assert.equal(item.height, 768);
  assert.deepEqual(mediaViewer.mediaViewerReferencesForCanvasNode(projectionDocument, output.id), [
    { id: "source-image", kind: "image", url: "/source.png", name: "Source image" },
  ]);
  assert.equal(mediaViewer.mediaViewerItemForCanvasNode(projectionDocument, { id: "draft", type: "prompt", x: 0, y: 0, data: {} }, null), null);
});

test("media viewer metadata falls back to node params and safe defaults", () => {
  const fallback = node({
    data: {
      kind: "image",
      params: { model: "fallback-model", resolution: "1K" },
      status: "failed",
      statusLabel: "failed by provider",
      prompt: "node prompt",
    },
  });
  const info = mediaViewer.mediaViewerVersionInfo(
    { nodes: [fallback], edges: [], groups: [] },
    fallback,
    null,
  );
  assert.equal(info.sourceNode, "直接生成");
  assert.equal(info.provider, "未记录");
  assert.equal(info.model, "fallback-model");
  assert.equal(info.dimensions, "1K");
  assert.equal(info.prompt, "node prompt");
  assert.equal(info.status, "失败");
  assert.equal(info.generationDurationMs, undefined);
});

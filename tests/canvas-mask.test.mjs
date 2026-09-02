import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compileTypeScript(path, transform = (source) => source) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = transform(await readFile(sourceUrl, "utf8"));
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
}

async function loadTypeScript(path, transform) {
  const compiled = await compileTypeScript(path, transform);
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const localEditRuntime = (await compileTypeScript("../lib/local-edit.ts"))
  .replace(/\bexport\s+/g, "");
const mask = await loadTypeScript("../lib/canvas/mask.ts", (source) => source.replace(
  /^import\s+\{\s*normalizeLocalEditAnnotations\s*\}\s+from\s+["']\.\.\/local-edit["'];?\s*$/m,
  localEditRuntime,
));

function imageNode(id, extra = {}) {
  return {
    id,
    type: "media",
    x: 0,
    y: 0,
    data: { kind: "image", url: `/${id}.png`, ...extra },
  };
}

function documentWith(...nodes) {
  return {
    version: "sanmao-canvas-2",
    nodes,
    edges: [],
    groups: [],
    camera: { x: 600, y: 380, zoom: 1 },
  };
}

test("legacy params.mask is normalized as a pending attached mask", () => {
  const result = mask.normalizeCanvasMaskState(undefined, {
    assetId: "mask-legacy",
    url: "/mask-legacy.png",
  });

  assert.deepEqual(result, {
    assetId: "mask-legacy",
    url: "/mask-legacy.png",
    status: "pending",
  });
});

test("mask state preserves metadata, clamps coverage and rejects invalid status", () => {
  const result = mask.normalizeCanvasMaskState({
    url: "/mask.png",
    status: "not-a-status",
    coverage: 3,
    taskId: "task-1",
    error: "old error",
  });

  assert.equal(result.status, "pending");
  assert.equal(result.coverage, 1);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.error, "old error");
  assert.equal(mask.canvasMaskStatusLabel("pending"), "待生成");
  assert.equal(mask.canvasMaskStatusLabel("running"), "生成中");
  assert.equal(mask.canvasMaskStatusLabel("used"), "已使用");
  assert.equal(mask.canvasMaskStatusLabel("failed"), "生成失败");
});

test("mask lifecycle updates pending, running, used, failed and remove independently per image", () => {
  const first = imageNode("first", {
    params: { mask: { assetId: "mask-1", url: "/mask-1.png" } },
  });
  const second = imageNode("second", {
    mask: { assetId: "mask-2", url: "/mask-2.png", status: "pending" },
  });
  let document = documentWith(first, second);

  document = mask.updateCanvasMaskState(document, "first", {
    status: "running",
    taskId: "task-1",
  });
  assert.equal(document.nodes[0].data.mask.status, "running");
  assert.equal(document.nodes[0].data.mask.taskId, "task-1");
  assert.equal(document.nodes[1].data.mask.status, "pending");

  document = mask.updateCanvasMaskState(document, "first", {
    status: "used",
    error: undefined,
  });
  assert.equal(document.nodes[0].data.mask.status, "used");
  assert.equal(document.nodes[0].data.mask.error, undefined);

  document = mask.updateCanvasMaskState(document, "first", {
    status: "failed",
    error: "生成失败",
  });
  assert.equal(document.nodes[0].data.mask.status, "failed");
  assert.equal(document.nodes[0].data.mask.error, "生成失败");

  const removed = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === "first"
        ? { ...node, data: { ...node.data, mask: undefined, params: {} } }
        : node,
    ),
  };
  assert.equal(removed.nodes[0].data.mask, undefined);
  assert.equal(removed.nodes[1].data.mask.status, "pending");
});

test("canvasMaskStateFromParams keeps legacy request data compatible", () => {
  const result = mask.canvasMaskStateFromParams(
    { mask: { assetId: "mask-3", url: "/mask-3.png" } },
    "used",
    { taskId: "task-3", coverage: 0.25 },
  );

  assert.deepEqual(result, {
    assetId: "mask-3",
    url: "/mask-3.png",
    status: "used",
    coverage: 0.25,
    taskId: "task-3",
  });
});

test("canvas mask state preserves normalized local-edit annotations", () => {
  const result = mask.normalizeCanvasMaskState({
    url: "/mask-annotated.png",
    annotations: [{
      id: "shoe",
      kind: "point",
      description: "修改鞋子",
      geometry: { kind: "point", x: 0.5, y: 0.5, radius: 0.04 },
      createdAt: 123,
    }],
  });

  assert.equal(result.annotations?.length, 1);
  assert.equal(result.annotations?.[0].geometry.kind, "point");
  assert.equal(result.annotations?.[0].description, "修改鞋子");
});

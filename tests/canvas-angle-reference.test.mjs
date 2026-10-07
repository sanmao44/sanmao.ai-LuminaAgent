import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/angle-reference.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source
  .replace('import type { ClientReferenceImage } from "../types";', '')
  .replace('import type { CanvasNode } from "./types";', ''), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const ready = (node) => Boolean(node && node.type === "media" && node.data.kind === "image" && node.data.url);

test("projects a ready data URL image with its inline data URL", () => {
  const node = { id: "image-1", type: "media", data: { kind: "image", url: "data:image/png;base64,abc", name: "Portrait" } };
  assert.deepEqual(references.canvasAngleReference(node, ready), {
    id: "image-1",
    name: "Portrait",
    kind: "image",
    url: "data:image/png;base64,abc",
    dataUrl: "data:image/png;base64,abc",
  });
});

test("keeps remote URLs without adding a data URL field", () => {
  const node = { id: "image-2", type: "media", data: { kind: "image", url: "/api/media/image-2" } };
  assert.deepEqual(references.canvasAngleReference(node, ready), {
    id: "image-2",
    name: "原始参考图",
    kind: "image",
    url: "/api/media/image-2",
  });
});

test("rejects non-ready, non-image, and missing nodes", () => {
  assert.equal(references.canvasAngleReference(undefined, ready), null);
  assert.equal(references.canvasAngleReference({ id: "video", type: "media", data: { kind: "video", url: "/video.mp4" } }, ready), null);
  assert.equal(references.canvasAngleReference({ id: "pending", type: "media", data: { kind: "image", url: "/pending.png" } }, () => false), null);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/smart-variant.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const smartVariant = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("projects only directly connected prompt sources and keeps their order", () => {
  const document = {
    nodes: [
      { id: "prompt-1", type: "prompt", data: { name: "Agent 1", agentResponse: "  first response  " } },
      { id: "prompt-2", type: "prompt", data: { name: "Agent 2", text: "second response" } },
      { id: "prompt-3", type: "prompt", data: { name: "Ignored", text: "not connected" } },
      { id: "generator", type: "generator", data: { prompt: "shared prompt" } },
    ],
    edges: [
      { id: "edge-1", source: "prompt-1", target: "generator", kind: "context" },
      { id: "edge-2", source: "prompt-2", target: "generator", kind: "reference" },
      { id: "edge-3", source: "prompt-3", target: "generator", kind: "generated" },
    ],
  };

  assert.deepEqual(
    smartVariant.canvasSmartVariantSources(document, document.nodes[3]),
    [
      { id: "shared-prompt", name: "共同提示词", text: "shared prompt" },
      { id: "prompt-1", name: "Agent 1", text: "first response" },
      { id: "prompt-2", name: "Agent 2", text: "second response" },
    ],
  );
});

test("returns no sources without a generator or a usable direct prompt", () => {
  const document = {
    nodes: [
      { id: "image", type: "media", data: { kind: "image" } },
      { id: "generator", type: "generator", data: { prompt: "" } },
      { id: "prompt", type: "prompt", data: { text: "" } },
    ],
    edges: [{ id: "edge", source: "prompt", target: "generator", kind: "context" }],
  };
  assert.deepEqual(smartVariant.canvasSmartVariantSources(document, document.nodes[0]), []);
  assert.deepEqual(smartVariant.canvasSmartVariantSources(document, document.nodes[1]), []);
});

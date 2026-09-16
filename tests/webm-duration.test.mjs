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

const { writeWebmDuration } = await loadTypeScript("../lib/canvas/webm-duration.ts");

function streamingWebm() {
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x80,
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x15, 0x49, 0xa9, 0x66, 0x87,
    0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
    0x1f, 0x43, 0xb6, 0x75, 0x80,
  ]);
}

test("writes a finite duration into streaming MediaRecorder WebM output", async () => {
  const output = await writeWebmDuration(new Blob([streamingWebm()], { type: "video/webm" }), 12.25);
  const bytes = new Uint8Array(await output.arrayBuffer());
  const offset = bytes.findIndex((value, index) => value === 0x44 && bytes[index + 1] === 0x89 && bytes[index + 2] === 0x88);
  assert.ok(offset > 0);
  assert.equal(new DataView(bytes.buffer).getFloat64(offset + 3, false), 12250);
  assert.equal(bytes[21], 0x92);
});

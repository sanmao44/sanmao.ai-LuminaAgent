import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/mention-resolution.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const mentions = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const image = { id: "image", type: "media", data: { kind: "image", url: "/image.png" } };
const video = { id: "video", type: "media", data: { kind: "video", url: "/video.mp4" } };
const audio = { id: "audio", type: "media", data: { kind: "audio", url: "/audio.mp3" } };
const prompt = { id: "prompt", type: "prompt", data: { text: "描述" } };
const candidates = [image, video, audio, prompt];
const isReferenceable = (node) => Boolean(
  node && (node.type === "media" || node.type === "upscale") && node.data.kind && node.data.url,
);

test("selects only explicitly mentioned referenceable media in candidate order", () => {
  const result = mentions.mentionedCanvasMedia("请用 @2 和 @1", candidates, isReferenceable);
  assert.deepEqual(result.map((node) => node.id), ["image", "video"]);
});

test("ignores invalid mention numbers and non-media prompt candidates", () => {
  const result = mentions.mentionedCanvasMedia("@0 @5 @4", candidates, isReferenceable);
  assert.deepEqual(result, []);
});

test("resolves image, video and prompt labels while preserving unknown tokens", () => {
  assert.equal(
    mentions.resolveCanvasMentionTokens("@1 @2 @4 @9", candidates),
    "参考图1 参考视频2 引用文本4 @9",
  );
});

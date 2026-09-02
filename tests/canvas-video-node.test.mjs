import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const types = await readFile(
  new URL("../lib/canvas/types.ts", import.meta.url),
  "utf8",
);
const mediaUrl = new URL("../lib/canvas/media.ts", import.meta.url);
const compiled = ts.transpileModule(await readFile(mediaUrl, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: mediaUrl.pathname,
}).outputText;
const media = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("formats loaded video durations without showing invalid values", () => {
  assert.equal(media.formatCanvasVideoDuration(6200), "6.2s");
  assert.equal(media.formatCanvasVideoDuration(90500), "1:30");
  assert.equal(media.formatCanvasVideoDuration(0), "");
  assert.equal(media.formatCanvasVideoDuration(Number.NaN), "");
});

test("video canvas cards expose a persistent visual and accessible distinction", () => {
  assert.match(types, /durationMs\?: number/);
  assert.match(component, /formatCanvasVideoDuration\(data\.durationMs\)/);
  assert.match(component, /className=\{`canvas-media-card\$\{data\.kind === "video" \? " video" : ""\}`\}/);
  assert.match(component, /className="canvas-video-mark"/);
  assert.match(component, /▶ 视频\{videoDuration \? ` · \$\{videoDuration\}` : ""\}/);
  assert.match(component, /className="canvas-video-play"/);
  assert.match(component, /title="播放视频预览"/);
  assert.match(component, /aria-label=\{`播放视频预览\$\{videoDuration/);
  assert.match(component, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onPreview\(\);/);
  assert.match(component, /<svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(component, /aria-label=\{`视频预览\$\{videoDuration/);
  assert.match(component, /className="canvas-image-resolution canvas-video-resolution"/);
  assert.match(component, /title=\{`视频分辨率 \$\{videoResolution\}`\}/);
  assert.match(component, /视频生成结果/);
  assert.match(component, /视频生成失败/);
  assert.match(styles, /\.canvas-media-card\.video\{/);
  assert.match(styles, /\.canvas-video-mark\{[^}]*border-radius:999px/);
  assert.match(styles, /\.canvas-node-footer em\.video-status\{/);
  assert.match(styles, /\.canvas-video-resolution\{[^}]*border-color:rgba\(147,197,253/);
});

test("video metadata persists both intrinsic size and duration on media nodes", () => {
  assert.match(component, /durationSeconds\?: number/);
  assert.match(component, /Math\.round\(durationSeconds \* 1000\)/);
  assert.match(component, /event\.currentTarget\.duration/);
  assert.match(component, /nativeWidth: width, nativeHeight: height/);
});

test("video canvas input mode supports automatic locking and restoration", () => {
  assert.match(types, /videoInputModeAuto\?: boolean/);
  assert.match(component, /videoInputModeAuto !== false/);
  assert.match(component, /videoInputModeAuto: false/);
  assert.match(component, /恢复自动/);
  assert.match(component, /preferredCanvasVideoInputModeForImageCount/);
  assert.match(component, /syncCanvasVideoReferences/);
});

test("video reference synchronization hydrates legacy generation params", () => {
  assert.match(component, /function videoParamsForCanvasNode\(node: CanvasNode, runtime: CanvasRuntimeState \| null\)/);
  assert.match(component, /node\.data\.generation\?\.params/);
  assert.doesNotMatch(component, /target\.data\.kind !== "video" \|\|[\s\S]{0,160}!target\.data\.params/);
  assert.match(component, /!hasTopLevelVideoParams/);
  assert.match(component, /updateCanvasVideoMode\(next, target\.id, inputMode, runtime\)/);
});

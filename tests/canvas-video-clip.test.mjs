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

const clip = await loadTypeScript("../lib/canvas/video-clip.ts");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/canvas/CanvasVideoClipWorkbench.tsx", import.meta.url), "utf8");
const canvasCss = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");
const types = await readFile(new URL("../lib/canvas/types.ts", import.meta.url), "utf8");

test("normalizes non-destructive video ranges and derives the effective duration", () => {
  const normalized = clip.normalizeCanvasVideoClipState({
    sourceNodeId: "video-source",
    startTime: -2,
    endTime: 30,
    volume: 2,
    muted: true,
    playbackRate: 1.5,
    fit: "cover",
  }, 12);
  assert.deepEqual(normalized, {
    version: 1,
    sourceNodeId: "video-source",
    startTime: 0,
    endTime: 12,
    volume: 1,
    muted: true,
    playbackRate: 1.5,
    fit: "cover",
  });
  assert.equal(clip.videoClipDurationSeconds(normalized), 8);

  const minimum = clip.normalizeCanvasVideoClipState({ startTime: 7, endTime: 7 }, 8);
  assert.ok(Math.abs((minimum.endTime - minimum.startTime) - clip.VIDEO_CLIP_MIN_DURATION) < 0.000001);
});

test("video clips stay ordinary media nodes and open the lightweight trimmer", () => {
  assert.match(types, /videoClip\?: CanvasVideoClipState/);
  assert.match(canvas, /createMedia\(\s*"video"/);
  assert.match(canvas, /renderCanvasVideoClip\(String\(source\.data\.url\), clip\)/);
  assert.match(canvas, /uploadCanvasAsset\(/);
  assert.match(canvas, /videoClip: outputClip/);
  assert.match(canvas, /durationMs: clipDurationMs/);
  assert.match(canvas, /kind: "lineage"/);
  assert.match(canvas, /else if \(node\.type === "media" && node\.data\.kind === "video" && node\.data\.url\) onOpenVideoClip\(\)/);
  assert.match(canvas, /id: "trim-video"/);
  assert.match(canvas, /<CanvasVideoClipWorkbench/);
});

test("trimmer keeps playback local and has Chinese trim, preview, and create controls", () => {
  assert.match(workbench, /<video/);
  assert.match(workbench, /onTimeUpdate/);
  assert.match(workbench, /renderTrimHandle\("start"\)/);
  assert.match(workbench, /renderTrimHandle\("end"\)/);
  assert.match(workbench, /空格播放 \/ 暂停/);
  assert.match(workbench, /创建剪辑/);
  assert.match(workbench, /canvas-video-clip-media fit-\$\{clip\.fit\}/);
  assert.match(workbench, /完整显示/);
  assert.match(workbench, /填满裁切/);
  assert.match(workbench, /canvas-video-clip-close/);
  assert.match(workbench, /canvas-video-clip-mute-toggle/);
  assert.match(workbench, /beginTimelineScrub/);
  assert.match(workbench, /scrubTimeline/);
  assert.match(workbench, /setPointerCapture/);
  assert.match(workbench, /onPointerMove=\{scrubTimeline\}/);
  assert.doesNotMatch(workbench, /fit-height|fit-width/);
  assert.match(workbench, /event\.key === "Escape"/);
});

test("timeline supports pointer capture for live scrubbing", () => {
  assert.match(workbench, /onPointerDown=\{beginTimelineScrub\}/);
  assert.match(workbench, /onPointerUp=\{endTimelineScrub\}/);
  assert.match(workbench, /onPointerCancel=\{endTimelineScrub\}/);
  assert.match(workbench, /onLostPointerCapture=\{endTimelineScrub\}/);
  assert.match(canvasCss, /canvas-video-clip-timeline\{touch-action:none;cursor:grab\}/);
  assert.match(canvasCss, /canvas-video-clip-timeline\.is-scrubbing\{cursor:grabbing\}/);
});

test("complete display delegates sizing to contain so the source is never cropped", () => {
  assert.match(canvasCss, /canvas-video-clip-preview>video\.canvas-video-clip-media\.fit-contain\{[^}]*object-fit:contain!important/);
  assert.match(canvasCss, /canvas-video-clip-preview>video\.canvas-video-clip-media\.fit-cover\{[^}]*object-fit:cover!important/);
});

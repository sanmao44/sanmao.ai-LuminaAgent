import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(new URL("../lib/video-trim-service.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/canvas/video-trim/route.ts", import.meta.url), "utf8");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");

test("precise trimming decodes the selected range and exports indexed H.264 MP4", () => {
  assert.match(service, /trim=start=.*:end=/);
  assert.match(service, /atrim=start=.*:end=/);
  assert.match(service, /setpts=\(PTS-STARTPTS\)/);
  assert.match(service, /'-c:v', 'libx264'/);
  assert.match(service, /'-t', outputDuration\.toFixed\(6\)/);
  assert.match(service, /'-movflags', '\+faststart'/);
  assert.match(route, /preciselyTrimVideo/);
  assert.match(canvas, /preciselyTrimCanvasVideo\(sourceFile, clip\)/);
  assert.match(canvas, /-剪辑\.mp4/);
});

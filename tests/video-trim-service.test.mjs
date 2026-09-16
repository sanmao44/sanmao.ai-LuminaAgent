import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";

const service = await readFile(new URL("../lib/video-trim-service.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/canvas/video-trim/route.ts", import.meta.url), "utf8");
const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");

test("precise trimming decodes the selected range and exports indexed H.264 MP4", () => {
  assert.match(service, /trim=start=.*:end=/);
  assert.match(service, /atrim=start=.*:end=/);
  assert.match(service, /setpts=\(PTS-STARTPTS\)/);
  assert.match(service, /fps=\$\{OUTPUT_FPS\}/);
  assert.match(service, /pad=ceil\(iw\/2\)\*2:ceil\(ih\/2\)\*2/);
  assert.match(service, /'-c:v', 'libx264'/);
  assert.match(service, /'-t', outputDuration\.toFixed\(6\)/);
  assert.match(service, /'-movflags', '\+faststart'/);
  assert.match(service, /path\.join\(process\.cwd\(\), 'node_modules', 'ffmpeg-static', binary\)/);
  assert.match(service, /process\.env\.FFMPEG_BIN/);
  assert.match(service, /command: 'ffmpeg'/);
  assert.match(service, /probeFfmpeg/);
  assert.match(service, /找不到可运行的 FFmpeg/);
  assert.match(service, /请重新运行启动器修复依赖/);
  assert.match(route, /preciselyTrimVideo/);
  assert.match(canvas, /preciselyTrimCanvasVideo\(sourceFile, clip\)/);
  assert.match(canvas, /-剪辑\.mp4/);
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr)));
  });
}

test("normalized output accepts odd source dimensions and has a finite duration", async (context) => {
  if (!ffmpegPath) return context.skip("ffmpeg-static is unavailable on this platform");
  const output = path.join(tmpdir(), `sanmao-video-trim-${process.pid}-${Date.now()}.mp4`);
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=317x241:r=1000:d=0.2",
      "-vf", "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "0.2", "-movflags", "+faststart", output,
    ]);
    const probe = await runFfmpeg(["-hide_banner", "-i", output, "-f", "null", "-"]);
    assert.match(probe, /Duration: 00:00:00\.20/);
    const dimensions = [...probe.matchAll(/\b(\d{2,5})x(\d{2,5})\b/g)]
      .find((match) => Number(match[1]) <= 16_384 && Number(match[2]) <= 16_384);
    assert.ok(dimensions);
    assert.equal(Number(dimensions[1]) % 2, 0);
    assert.equal(Number(dimensions[2]) % 2, 0);
    assert.match(probe, /30 fps/);
  } finally {
    await rm(output, { force: true });
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";

const service = await readFile(new URL("../lib/video-depth-service.ts", import.meta.url), "utf8");
const probeRoute = await readFile(new URL("../app/api/canvas/video-depth/probe/route.ts", import.meta.url), "utf8");
const encodeRoute = await readFile(new URL("../app/api/canvas/video-depth/encode/route.ts", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

test("depth-video encodes an image sequence at source fps as a broadly compatible H.264 MP4", () => {
  assert.match(service, /frameRateFromMetadata/);
  assert.match(service, /metadata\.matchAll\(\/\\b\(\\d\+\(\?:\\\.\\d\+\)\?\)\\s\*fps\\b\/gi\)/);
  assert.match(service, /"-c:v", "libx264"/);
  assert.match(service, /"-pix_fmt", "yuv420p"/);
  assert.match(service, /"-profile:v", "high"/);
  assert.match(service, /"-movflags", "\+faststart"/);
  assert.match(service, /unzipSync/);
  assert.match(service, /"-framerate", String\(fps\), "-start_number", "0"/);
  assert.match(service, /"frame-%06d\.webp"/);
  assert.match(service, /"-frames:v", String\(totalFrames\)/);
  assert.match(service, /"-vf", "pad=ceil\(iw\/2\)\*2:ceil\(ih\/2\)\*2"/);
  assert.match(probeRoute, /probeDepthVideoFrameRate/);
  assert.match(encodeRoute, /encodeDepthVideoFrameSequence/);
  assert.match(encodeRoute, /form\.get\("archive"\)/);
  assert.match(encodeRoute, /Content-Type": "video\/mp4/);
  assert.match(nextConfig, /'\/api\/canvas\/video-depth\/probe': \['\.\/node_modules\/ffmpeg-static\/ffmpeg\*'\]/);
  assert.match(nextConfig, /'\/api\/canvas\/video-depth\/encode': \['\.\/node_modules\/ffmpeg-static\/ffmpeg\*'\]/);
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

test("depth-video image-sequence MP4 settings produce H.264 yuv420p at the source frame rate", async (context) => {
  if (!ffmpegPath) return context.skip("ffmpeg-static is unavailable on this platform");
  const stamp = `${process.pid}-${Date.now()}`;
  const output = path.join(tmpdir(), `sanmao-depth-video-${stamp}.mp4`);
  const framePattern = path.join(tmpdir(), `sanmao-depth-frame-${stamp}-%06d.png`);
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=s=704x1280:r=1:d=3",
      "-frames:v", "3", framePattern,
    ]);
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", "29.97", "-start_number", "1", "-i", framePattern,
      "-frames:v", "3", "-r", "29.97", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-an", "-movflags", "+faststart", output,
    ]);
    const metadata = await runFfmpeg(["-hide_banner", "-i", output, "-f", "null", "-"]);
    assert.match(metadata, /h264 \(High\).*yuv420p/i);
    assert.match(metadata, /29\.97 fps/);
    assert.match(metadata, /704x1280/);
  } finally {
    await rm(output, { force: true });
    await Promise.all(Array.from({ length: 3 }, (_, index) => rm(
      path.join(tmpdir(), `sanmao-depth-frame-${stamp}-${String(index + 1).padStart(6, "0")}.png`),
      { force: true },
    )));
  }
});

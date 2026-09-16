import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { unzipSync } from "fflate";

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), ".data");
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const MIN_FRAME_RATE = 1;
const MAX_FRAME_RATE = 60;
const MAX_FRAME_COUNT = 30 * MAX_FRAME_RATE;

let resolvedFfmpegPromise: Promise<string> | null = null;

function ffmpegFileName() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function ffmpegCandidates() {
  const binary = ffmpegFileName();
  return [...new Set([
    process.env.FFMPEG_BIN,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", binary),
    path.join(path.dirname(process.execPath), "node_modules", "ffmpeg-static", binary),
    ffmpegPath,
  ].filter((value): value is string => Boolean(value)))];
}

function canRun(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["-version"], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

async function resolveFfmpegUncached() {
  for (const candidate of ffmpegCandidates()) {
    const command = path.resolve(candidate);
    try {
      await access(command, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
      if (await canRun(command)) return command;
    } catch {
      // Try the next bundled or system installation location.
    }
  }
  if (await canRun("ffmpeg")) return "ffmpeg";
  throw new Error("找不到可运行的 FFmpeg，请重新运行启动器修复依赖。");
}

function resolveFfmpeg() {
  if (!resolvedFfmpegPromise) {
    resolvedFfmpegPromise = resolveFfmpegUncached();
    resolvedFfmpegPromise.catch(() => { resolvedFfmpegPromise = null; });
  }
  return resolvedFfmpegPromise;
}

async function runFfmpeg(args: string[], failureMessage: string, allowFailure = false) {
  const command = await resolveFfmpeg();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
    child.once("error", () => reject(new Error("无法启动 FFmpeg，请重新运行启动器修复依赖。")));
    child.once("close", (code) => {
      if (code === 0 || allowFailure) resolve(stderr);
      else reject(new Error(`${failureMessage}${stderr.trim() ? `：${stderr.trim().split(/\r?\n/).at(-1)}` : ""}`));
    });
  });
}

function frameRateFromMetadata(metadata: string) {
  const matches = [...metadata.matchAll(/\b(\d+(?:\.\d+)?)\s*fps\b/gi)];
  const value = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(value) || value < MIN_FRAME_RATE || value > MAX_FRAME_RATE) {
    throw new Error("无法识别原视频帧率；请使用帧率不超过 60 FPS 的 MP4 或 WebM 视频。");
  }
  return Math.round(value * 1000) / 1000;
}

async function withWorkingFile<T>(file: File, task: (inputPath: string, working: string) => Promise<T>) {
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error("视频为空或超过 512MB 限制。");
  const working = path.join(dataDir, "video-depth-temp", randomUUID());
  const inputPath = path.join(working, "input");
  await mkdir(working, { recursive: true });
  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return await task(inputPath, working);
  } finally {
    await rm(working, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Read the source video's real frame rate with the bundled FFmpeg metadata parser. */
export function probeDepthVideoFrameRate(file: File) {
  return withWorkingFile(file, async (inputPath) => {
    const metadata = await runFfmpeg(["-hide_banner", "-i", inputPath], "读取视频信息失败", true);
    return frameRateFromMetadata(metadata);
  });
}

export async function encodeDepthVideoFrameSequence(archive: File, frameRate: number, frameCount: number) {
  const fps = Number(frameRate);
  if (!Number.isFinite(fps) || fps < MIN_FRAME_RATE || fps > MAX_FRAME_RATE) {
    throw new Error("深度视频帧率无效，支持 1 到 60 FPS。");
  }
  const totalFrames = Math.round(Number(frameCount));
  if (!Number.isFinite(totalFrames) || totalFrames < 1 || totalFrames > MAX_FRAME_COUNT) {
    throw new Error(`深度帧数量无效，支持 1 到 ${MAX_FRAME_COUNT} 帧。`);
  }
  return withWorkingFile(archive, async (archivePath, working) => {
    const framesPath = path.join(working, "frames");
    const outputPath = path.join(working, "output.mp4");
    const entries = unzipSync(await readFile(archivePath));
    const expectedNames = Array.from({ length: totalFrames }, (_, index) => `frame-${String(index).padStart(6, "0")}.webp`);
    if (Object.keys(entries).length !== expectedNames.length || expectedNames.some((name) => !entries[name]?.byteLength)) {
      throw new Error("深度帧序列不完整，请重新生成。");
    }
    await mkdir(framesPath, { recursive: true });
    await Promise.all(expectedNames.map((name) => writeFile(path.join(framesPath, name), entries[name], { flag: "wx" })));
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", String(fps), "-start_number", "0",
      "-i", path.join(framesPath, "frame-%06d.webp"),
      "-map", "0:v:0",
      "-frames:v", String(totalFrames), "-r", String(fps),
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-an", "-movflags", "+faststart",
      outputPath,
    ], "深度视频 MP4 编码失败");
    const output = await readFile(outputPath);
    if (!output.byteLength) throw new Error("深度视频没有生成有效的 MP4 文件。");
    return output;
  });
}

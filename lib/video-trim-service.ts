import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const OUTPUT_FPS = 30;
let resolvedFfmpegPromise: Promise<{ command: string; checked: string[] }> | null = null;

export type PreciseVideoTrimInput = {
  file: File;
  startTime: number;
  endTime: number;
  playbackRate: number;
  muted: boolean;
};

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ffmpegFileName() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function ffmpegCandidates() {
  const binary = ffmpegFileName();
  const values = [
    process.env.FFMPEG_BIN,
    // next build bundles ffmpeg-static's index.js, so its exported __dirname
    // can point at the route bundle. Resolve from the application root first.
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', binary),
    path.join(path.dirname(process.execPath), 'node_modules', 'ffmpeg-static', binary),
    ffmpegPath,
  ];
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function probeFfmpeg(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ['-version'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

async function resolveFfmpegUncached() {
  const checked: string[] = [];
  for (const candidate of ffmpegCandidates()) {
    const resolved = path.resolve(candidate);
    checked.push(resolved);
    try {
      await access(resolved, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
      if (await probeFfmpeg(resolved)) return { command: resolved, checked };
    } catch {
      // Try the next installation layout.
    }
  }
  // A system-managed FFmpeg remains a useful fallback for Docker and Linux.
  checked.push('ffmpeg (PATH)');
  if (await probeFfmpeg('ffmpeg')) return { command: 'ffmpeg', checked };
  throw new Error(`找不到可运行的 FFmpeg；已检查：${checked.join('、')}。请重新运行启动器修复依赖。`);
}

function resolveFfmpeg() {
  if (!resolvedFfmpegPromise) {
    resolvedFfmpegPromise = resolveFfmpegUncached();
    resolvedFfmpegPromise.catch(() => { resolvedFfmpegPromise = null; });
  }
  return resolvedFfmpegPromise;
}

async function runFfmpeg(args: string[]) {
  const { command, checked } = await resolveFfmpeg();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      const locations = checked.length ? `；已检查：${checked.join('、')}` : '';
      fail(new Error(`无法启动 FFmpeg（${error.code || error.message}）${locations}。请重新运行启动器修复依赖。`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`视频精确裁剪失败${stderr.trim() ? `：${stderr.trim().split(/\r?\n/).at(-1)}` : ''}`));
    });
  });
}

export async function preciselyTrimVideo(input: PreciseVideoTrimInput) {
  if (!input.file.size || input.file.size > MAX_INPUT_BYTES) throw new Error('视频为空或超过 512MB 限制。');
  const startTime = Math.max(0, finiteNumber(input.startTime, 0));
  const endTime = Math.min(MAX_DURATION_SECONDS, finiteNumber(input.endTime, 0));
  const playbackRate = finiteNumber(input.playbackRate, 1);
  if (endTime <= startTime || ![0.5, 1, 1.5, 2].includes(playbackRate)) throw new Error('视频裁剪参数无效。');
  const outputDuration = (endTime - startTime) / playbackRate;

  const working = path.join(dataDir, 'video-trim-temp', randomUUID());
  const inputPath = path.join(working, 'input');
  const outputPath = path.join(working, 'output.mp4');
  await mkdir(working, { recursive: true });
  try {
    await writeFile(inputPath, Buffer.from(await input.file.arrayBuffer()), { flag: 'wx' });
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `trim=start=${startTime.toFixed(6)}:end=${endTime.toFixed(6)},setpts=(PTS-STARTPTS)/${playbackRate},fps=${OUTPUT_FPS},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
      ...(input.muted ? ['-an'] : ['-af', `atrim=start=${startTime.toFixed(6)}:end=${endTime.toFixed(6)},asetpts=PTS-STARTPTS,atempo=${playbackRate}`]),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p',
      ...(input.muted ? [] : ['-c:a', 'aac', '-b:a', '192k']),
      '-t', outputDuration.toFixed(6),
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero',
      outputPath,
    ];
    await runFfmpeg(args);
    const buffer = await readFile(outputPath);
    if (!buffer.byteLength) throw new Error('视频裁剪没有生成有效文件。');
    return buffer;
  } finally {
    await rm(working, { recursive: true, force: true }).catch(() => undefined);
  }
}

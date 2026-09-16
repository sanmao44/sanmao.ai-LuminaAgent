import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

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

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('当前安装包缺少 FFmpeg，无法进行精确视频裁剪。'));
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.once('error', () => reject(new Error('无法启动 FFmpeg，请重新安装应用后重试。')));
    child.once('close', (code) => {
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
      '-vf', `trim=start=${startTime.toFixed(6)}:end=${endTime.toFixed(6)},setpts=(PTS-STARTPTS)/${playbackRate}`,
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

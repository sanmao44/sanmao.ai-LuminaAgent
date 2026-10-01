import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveFfmpeg } from './video-trim-service';

type VideoAspectNormalization = { buffer: Buffer; ext: string; changed: boolean };

function parseAspectRatio(value: unknown) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function outputDimensions(ratio: number) {
  const longEdge = 1280;
  if (ratio >= 1) return { width: longEdge, height: Math.max(2, Math.round(longEdge / ratio / 2) * 2) };
  return { width: Math.max(2, Math.round(longEdge * ratio / 2) * 2), height: longEdge };
}

function runFfmpeg(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`)));
  });
}

function probeVideoDimensions(command: string, inputPath: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const child = spawn(command, ['-hide_banner', '-i', inputPath, '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
    child.once('error', () => resolve(null));
    child.once('close', () => {
      const match = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/s);
      resolve(match ? { width: Number(match[1]), height: Number(match[2]) } : null);
    });
  });
}

/** Preserve the generated composition while enforcing the requested output canvas. */
export async function normalizeVideoAspect(buffer: Buffer, inputExt: string, aspectRatio?: string): Promise<VideoAspectNormalization> {
  const ratio = parseAspectRatio(aspectRatio);
  if (!Buffer.isBuffer(buffer) || !buffer.length || !ratio) return { buffer, ext: inputExt || 'mp4', changed: false };
  const { width, height } = outputDimensions(ratio);
  const work = await mkdtemp(path.join(os.tmpdir(), 'sanmao-video-aspect-'));
  const inputPath = path.join(work, `input.${inputExt || 'mp4'}`);
  const outputPath = path.join(work, 'output.mp4');
  try {
    await writeFile(inputPath, buffer, { flag: 'wx' });
    const { command } = await resolveFfmpeg();
    const source = await probeVideoDimensions(command, inputPath);
    if (source && Math.abs(source.width / source.height - ratio) < 0.01) return { buffer, ext: inputExt || 'mp4', changed: false };
    const filter = [
      `split=2[bg][fg]`,
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:1[bg]`,
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`,
    ].join(';');
    await runFfmpeg(command, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-filter_complex', filter, '-map', '[vout]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
    return { buffer: await readFile(outputPath), ext: 'mp4', changed: true };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

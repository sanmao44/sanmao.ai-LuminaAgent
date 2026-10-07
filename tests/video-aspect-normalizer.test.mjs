import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { buildLibModules } from './lib-build.mjs';

const { load } = await buildLibModules(['lib/video-trim-service', 'lib/video-aspect-normalizer'], 'video-aspect-normalizer');
const normalizer = await load('video-aspect-normalizer');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr)));
  });
}

test('normalizes an Agnes landscape result to the requested portrait canvas', async (context) => {
  if (!ffmpegPath) return context.skip('ffmpeg-static is unavailable on this platform');
  const root = path.join(tmpdir(), `sanmao-video-aspect-${process.pid}-${Date.now()}`);
  const input = path.join(root, 'input.mp4');
  try {
    await mkdir(root, { recursive: true });
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1400x788:r=24:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    const result = await normalizer.normalizeVideoAspect(await readFile(input), 'mp4', '9:16');
    assert.equal(result.changed, true);
    assert.equal(result.ext, 'mp4');
    const output = path.join(root, 'output.mp4');
    await writeFile(output, result.buffer);
    const probe = await runFfmpeg(['-hide_banner', '-i', output, '-f', 'null', '-']);
    assert.match(probe, /720x1280/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

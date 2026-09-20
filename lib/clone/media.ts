/**
 * 克隆出片用到的 FFmpeg 能力：测时长、抽帧。
 * 复用 video-trim-service 里同一套 ffmpeg-static 解析，避免两份二进制查找逻辑。
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpeg } from '../video-trim-service';
import { parseFfmpegDuration } from './plan';

const STREAM_TIMEOUT_MS = 120_000;

/** 跑一次 ffmpeg 并保留 stderr；注意「只读探测」（-i 且无输出）本来就会返回非 0。 */
export async function runFfmpegCapture(args: string[], timeoutMs = STREAM_TIMEOUT_MS) {
  const { command, checked } = await resolveFfmpeg();
  return new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 已经退出 */ }
      reject(new Error('FFmpeg 执行超时，已终止。'));
    }, Math.max(5_000, timeoutMs));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`无法启动 FFmpeg（${error.code || error.message}）；已检查：${checked.join('、')}。请重新运行启动器修复依赖。`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** 读媒体时长（秒）；ffmpeg-static 不带 ffprobe，只能用 -i 的 stderr。 */
export async function probeMediaSeconds(file: string) {
  const { stderr } = await runFfmpegCapture(['-hide_banner', '-i', file], 30_000);
  return parseFfmpegDuration(stderr);
}

/**
 * 按给定时间点抽帧，输出 jpg；单帧失败只是少一帧，不打断整条管线。
 * 一帧都没抽到时会带上 ffmpeg 的报错：否则「拆不出画面」这条降级根本没法排查。
 */
export async function extractFrameFiles(input: string, times: number[], outDir: string) {
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  let failure = '';
  for (const [index, time] of times.entries()) {
    const out = path.join(outDir, `frame-${String(index).padStart(2, '0')}.jpg`);
    const result = await runFfmpegCapture([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(Math.max(0, Number(time) || 0)),
      '-i', input,
      '-frames:v', '1',
      // 过滤图里的逗号必须转义：否则 ffmpeg 会把 min(720,iw) 拆成两个过滤器，抽帧全部失败。
      '-vf', 'scale=min(720\\,iw):-2',
      '-q:v', '4',
      out,
    ], 60_000);
    if (result.code === 0) files.push(out);
    else failure = failure || result.stderr.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return { files, error: files.length ? '' : failure };
}

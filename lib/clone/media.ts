/**
 * 克隆出片用到的 FFmpeg 能力：测时长、抽帧。
 * 复用 video-trim-service 里同一套 ffmpeg-static 解析，避免两份二进制查找逻辑。
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpeg } from '../video-trim-service';
import { parseFfmpegDuration, parseSceneChangeTimes } from './plan';

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
 * Detect hard scene boundaries locally before asking the vision model to
 * describe the reference. The model still decides what each shot means, but
 * it receives real cut timestamps instead of having to infer every edit from a
 * sparse uniform sample. A detection failure is intentionally non-fatal: a
 * reference video must still be clonable with uniform sampling.
 */
export async function detectSceneChanges(input: string, options: { durationSeconds?: number; threshold?: number; maxChanges?: number } = {}) {
  const duration = Number(options.durationSeconds);
  const threshold = Math.min(0.9, Math.max(0.05, Number(options.threshold) || 0.3));
  const maxChanges = Math.max(1, Math.min(64, Math.round(Number(options.maxChanges) || 32)));
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'info', '-i', input,
    '-an', '-vf', `select=gt(scene\\,${threshold.toFixed(2)}),showinfo`,
    '-f', 'null', '-',
  ], Math.max(60_000, Number.isFinite(duration) ? Math.round(duration * 4_000) : 120_000));
  const times = parseSceneChangeTimes(result.stderr, duration, maxChanges);
  return {
    times,
    error: result.code === 0 || times.length ? '' : result.stderr.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

/**
 * Normalize the reference audio for the local ASR backend.  Whisper expects
 * mono 16 kHz PCM; doing this with the same bundled FFmpeg as the rest of the
 * clone pipeline keeps decoding deterministic across Windows and macOS.
 */
export async function extractSpeechAudio(input: string, output: string) {
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:a:0',
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    output,
  ], 120_000);
  return result.code === 0 ? output : null;
}

/** Export the reference music/ambience as one reusable local audio asset. */
export async function extractReferenceAudioTrack(input: string, output: string) {
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:a:0',
    '-vn', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', output,
  ], 180_000);
  return result.code === 0 ? output : null;
}

/**
 * 按给定时间点抽帧，输出 jpg；单帧失败只是少一帧，不打断整条管线。
 * 一帧都没抽到时会带上 ffmpeg 的报错：否则「拆不出画面」这条降级根本没法排查。
 */
export async function extractFrameFiles(input: string, times: number[], outDir: string) {
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  const successfulTimes: number[] = [];
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
    if (result.code === 0) {
      files.push(out);
      successfulTimes.push(Math.max(0, Number(time) || 0));
    }
    else failure = failure || result.stderr.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return { files, times: successfulTimes, error: files.length ? '' : failure };
}

/**
 * Prepare one analysis frame from a still-image reference without turning the
 * reference itself into a video. The final assembler may create a static MP4,
 * but vision analysis must keep the image's single-scene semantics.
 */
export async function prepareImageFrame(input: string, output: string) {
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=min(720\\,iw):-2',
    '-q:v', '4',
    output,
  ], 60_000);
  if (result.code !== 0) throw new Error(`参考图读取失败：${result.stderr.replace(/\\s+/g, ' ').trim().slice(0, 240)}`);
  return output;
}

/**
 * Export the exact reference-video window used by one generated shot.
 * Keeping this as a real video (rather than only a text description) lets
 * providers that support video references preserve movement, cadence and
 * graphics from the corresponding source interval.
 */
export async function extractVideoSegment(input: string, start: number, end: number, output: string) {
  const safeStart = Math.max(0, Number.isFinite(Number(start)) ? Number(start) : 0);
  const safeEnd = Math.max(safeStart + 0.1, Number.isFinite(Number(end)) ? Number(end) : safeStart + 0.1);
  const result = await runFfmpegCapture([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', safeStart.toFixed(3),
    '-i', input,
    '-t', (safeEnd - safeStart).toFixed(3),
    '-map', '0:v:0',
    '-an',
    '-vf', 'scale=min(720\\,iw):-2,fps=24',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ], 180_000);
  if (result.code !== 0) throw new Error(`参考镜头片段导出失败：${result.stderr.replace(/\s+/g, ' ').trim().slice(0, 240)}`);
  return output;
}

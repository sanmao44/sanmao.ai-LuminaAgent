import { spawn } from 'node:child_process';
import { resolveFfmpeg } from '../video-trim-service';

export async function decodeAudioToPcmWav(inputPath: string, outputPath: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const { command, checked } = await resolveFfmpeg();
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 120_000);
  const signal = options.signal;
  if (signal?.aborted) throw signal.reason || new Error('Audio decoding cancelled');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', inputPath,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      try { child.kill(); } catch { /* The process may already have exited. */ }
      finish(signal?.reason instanceof Error ? signal.reason : new Error('Audio decoding cancelled'));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* The process may already have exited. */ }
      finish(new Error('FFmpeg audio decoding timed out'));
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(new Error(`Unable to start FFmpeg (${error.code || error.message}); checked ${checked.join(', ')}`));
    });
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim().slice(-1_000) || `FFmpeg exited with code ${code ?? -1}`));
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

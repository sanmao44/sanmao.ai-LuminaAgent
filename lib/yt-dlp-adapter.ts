import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * The yt-dlp adapter is deliberately narrower than a general process runner.
 * Callers provide a URL and an output directory; all command-line arguments
 * are assembled here and the child is never started through a shell.
 */

export type YtDlpProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type YtDlpProcessInput = {
  command: string;
  args: readonly string[];
  cwd: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
};

export type YtDlpProcessRunner = (input: YtDlpProcessInput) => Promise<YtDlpProcessResult>;

export type YtDlpDownloadRequest = {
  url: string;
  outputDirectory: string;
  /** Keep the format surface intentionally small; arbitrary CLI options stay unavailable. */
  format?: 'best' | 'bestvideo+bestaudio/best';
  ffmpegPath?: string;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
};

export type YtDlpDownloadResult = {
  filePath: string;
  bytes: number;
  command: string;
  args: readonly string[];
};

export type YtDlpProbeResult = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export class YtDlpUnavailableError extends Error {
  constructor(message = 'yt-dlp 不可用，请先安装 yt-dlp 并将其加入 PATH。') {
    super(message);
    this.name = 'YtDlpUnavailableError';
  }
}
export class YtDlpDownloadError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, details: { exitCode?: number | null; stderr?: string } = {}) {
    super(message);
    this.name = 'YtDlpDownloadError';
    this.exitCode = details.exitCode ?? null;
    this.stderr = details.stderr || '';
  }
}

const MEDIA_EXTENSIONS = new Set(['.avi', '.flv', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm']);
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'host.docker.internal']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

function configuredCommand(explicit?: string) {
  const configured = String(explicit || process.env.SANMAO_YTDLP_PATH || process.env.YT_DLP_PATH || '').trim();
  if (configured) return configured;
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/** yt-dlp is a server-side fetcher; never let a public-video tool target local networks. */
function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host === '::' || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.includes(':')) return host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.') || host.startsWith('::ffff:172.');
  if (/^\d+$/.test(host)) return true;
  const parts = host.split('.').map((value) => Number(value));
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19));
}

function assertHttpUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('视频地址不能为空。');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('视频地址必须是有效的 HTTP 或 HTTPS URL。'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('视频地址只允许 HTTP 或 HTTPS。');
  if (parsed.username || parsed.password) throw new Error('视频地址不能包含用户名或密码。');
  if (isBlockedHost(parsed.hostname)) throw new Error('视频地址不能指向本机或内网地址。');
  return parsed.toString();
}

function resolveOutputDirectory(value: string) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('视频输出目录不能为空。');
  const outputDirectory = path.resolve(raw);
  if (outputDirectory === path.parse(outputDirectory).root) throw new Error('视频输出目录不能是文件系统根目录。');
  return outputDirectory;
}

function isPathInside(filePath: string, directory: string) {
  const file = path.resolve(filePath);
  const root = path.resolve(directory);
  return file !== root && file.startsWith(`${root}${path.sep}`);
}

function outputTemplate(outputDirectory: string) {
  return path.join(outputDirectory, '%(id)s.%(ext)s');
}

/** Build the complete fixed argument list used for every download. */
export function buildYtDlpArguments(request: Pick<YtDlpDownloadRequest, 'url' | 'outputDirectory' | 'format' | 'ffmpegPath'>) {
  const url = assertHttpUrl(request.url);
  const outputDirectory = resolveOutputDirectory(request.outputDirectory);
  if (request.format !== undefined && request.format !== 'best' && request.format !== 'bestvideo+bestaudio/best') {
    throw new Error('不支持的视频格式选项。');
  }
  const args: string[] = [
    '--no-playlist',
    '--playlist-items', '1',
    '--max-filesize', '1G',
    '--no-cache-dir',
    '--restrict-filenames',
    '--no-overwrites',
    '--newline',
    '--no-write-info-json',
    '--no-write-thumbnail',
    '--no-write-description',
    '--no-write-playlist-metafiles',
    '--no-simulate',
    '--print', 'after_move:filepath',
    '--output', outputTemplate(outputDirectory),
    '--format', request.format || 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
  ];
  const ffmpegPath = String(request.ffmpegPath || '').trim();
  if (ffmpegPath) args.push('--ffmpeg-location', path.resolve(ffmpegPath));
  // Keep the URL as the final positional argument. The adapter never invokes a
  // shell, and the separator prevents a URL beginning with '-' from becoming
  // another yt-dlp option.
  args.push('--', url);
  return args;
}

function spawnYtDlp(input: YtDlpProcessInput): Promise<YtDlpProcessResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: YtDlpProcessResult) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result as YtDlpProcessResult);
    };
    const abort = () => {
      if (!child.killed) child.kill('SIGTERM');
    };
    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stdout += text;
      input.onOutput?.(text);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stderr += text;
      input.onOutput?.(text);
    });
    child.once('error', (error) => {
      input.signal?.removeEventListener('abort', abort);
      finish(error);
    });
    child.once('close', (exitCode, signal) => {
      input.signal?.removeEventListener('abort', abort);
      finish(undefined, { exitCode, signal, stdout, stderr });
    });
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) {
      abort();
      finish(input.signal.reason instanceof Error ? input.signal.reason : new Error('yt-dlp 下载已取消。'));
      return;
    }
  });
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function findPrintedFile(stdout: string, outputDirectory: string) {
  for (const candidate of lines(stdout).reverse()) {
    const resolved = path.resolve(candidate);
    if (!isPathInside(resolved, outputDirectory)) continue;
    if (!MEDIA_EXTENSIONS.has(path.extname(resolved).toLowerCase())) continue;
    try {
      const details = await stat(resolved);
      if (details.isFile() && details.size > 0) return { filePath: resolved, bytes: details.size };
    } catch {
      // yt-dlp can print a transient path before the rename. Continue looking.
    }
  }
  return null;
}

export async function downloadWithYtDlp(request: YtDlpDownloadRequest, dependencies: { command?: string; run?: YtDlpProcessRunner } = {}): Promise<YtDlpDownloadResult> {
  const outputDirectory = resolveOutputDirectory(request.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const command = configuredCommand(dependencies.command);
  const args = buildYtDlpArguments({ ...request, outputDirectory });
  const run = dependencies.run || spawnYtDlp;
  let processResult: YtDlpProcessResult;
  try {
    processResult = await run({ command, args, cwd: outputDirectory, signal: request.signal, onOutput: request.onProgress });
  } catch (error) {
    if (request.signal?.aborted) throw request.signal.reason || new Error('yt-dlp 下载已取消。');
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    if (code === 'ENOENT') throw new YtDlpUnavailableError();
    throw error;
  }
  if (request.signal?.aborted) throw request.signal.reason || new Error('yt-dlp 下载已取消。');
  if (processResult.exitCode !== 0) {
    const detail = lines(processResult.stderr).slice(-3).join(' ');
    throw new YtDlpDownloadError(detail || 'yt-dlp 下载失败。', { exitCode: processResult.exitCode, stderr: processResult.stderr });
  }
  const file = await findPrintedFile(processResult.stdout, outputDirectory);
  if (!file) throw new YtDlpDownloadError('yt-dlp 已结束，但没有找到输出视频文件。', { exitCode: processResult.exitCode, stderr: processResult.stderr });
  return { ...file, command, args };
}

export async function probeYtDlp(dependencies: { command?: string; run?: YtDlpProcessRunner } = {}): Promise<YtDlpProbeResult> {
  const command = configuredCommand(dependencies.command);
  const run = dependencies.run || spawnYtDlp;
  try {
    const result = await run({ command, args: ['--version'], cwd: process.cwd() });
    if (result.exitCode !== 0) return { available: false, command, error: lines(result.stderr).slice(-1)[0] || 'yt-dlp 版本探测失败。' };
    const version = lines(result.stdout)[0];
    return { available: true, command, ...(version ? { version } : {}) };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    return { available: false, command, error: code === 'ENOENT' ? '未找到 yt-dlp 可执行文件。' : error instanceof Error ? error.message : 'yt-dlp 版本探测失败。' };
  }
}


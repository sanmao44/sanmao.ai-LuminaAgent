import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { BilibiliPublicMediaError, isBilibiliVideoUrl, resolveBilibiliPublicMedia } from './bilibili-download';
import { resolveLocalDataDir } from './data-paths';
import { resolveVideoDownloadProxy } from './video-download-network';
import { XinpianchangPublicMediaError, isXinpianchangVideoUrl, resolveXinpianchangPublicMedia } from './xinpianchang-download';
import { resolveVideoDownloadBrowser } from './video-download-browser';
import { isDouyinVideoUrl, isWeixinChannelsShareUrl } from './video-download-platforms';
import type { VideoDownloadBrowserSession } from '@/packages/contracts/video-download';

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
  /** Set only after explicit user authorization for the current site URL. */
  cookiesFromBrowser?: VideoDownloadBrowserSession;
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

type PublicMediaHeaders = Readonly<{ Range?: string; Referer: string; 'User-Agent'?: string }>;

export class YtDlpUnavailableError extends Error {
  constructor(message = '视频下载技能已启用，但本机下载器未就绪。启动器会自动准备 yt-dlp；请重新启动 SANMAO.AI 后再试。') {
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

function summarizeYtDlpFailure(stderr: string, stdout: string, sourceUrl?: string) {
  const output = stderr + '\n' + stdout;
  if (/Could not copy .*cookie database|database is locked|unable to copy .*cookies?/i.test(output)) {
    return '无法复制默认浏览器的 Cookie 数据库，通常是浏览器仍在运行并锁定了 profile。请完全退出 Tabbit/Chrome（包括后台进程）后重试；如果仍失败，请改用 Firefox 会话或导出当前站点的 cookies.txt。';
  }
  if (/Failed to decrypt with DPAPI|Application.?Bound Encryption|could not decrypt .*cookie/i.test(output)) {
    return 'Chrome/Chromium 的新版应用绑定加密阻止 yt-dlp 读取这个浏览器配置的 Cookie。请改用已登录的 Firefox 会话重试，或用浏览器 Cookie 导出工具仅导出该站点的 cookies.txt 后再配置使用；项目不会绕过浏览器加密。';
  }
  if (/This video is unavailable|Video unavailable|This video is no longer available|视频不存在|稿件不可见/i.test(output)) {
    return '该视频已不可播放或已被站点移除，无法下载。';
  }
  if (sourceUrl && isDouyinVideoUrl(sourceUrl) && /Fresh cookies|fresh cookie|web detail JSON: HTTP Error 403/i.test(output)) {
    return '站点返回 HTTP 403：抖音要求本次解析使用新鲜浏览器 Cookie（通常不要求登录）。请先在本机浏览器打开并正常播放该链接，再明确授权本次下载读取 Chrome、Edge 或 Firefox 的匹配 Cookie 后重试；项目不会绕过抖音风控。';
  }
  if (sourceUrl && isWeixinChannelsShareUrl(sourceUrl) && /Unsupported URL|No suitable extractor|not a valid URL|not supported/i.test(output)) {
    return '微信视频号分享页目前没有官方 yt-dlp 提取器。GitHub 上的相关案例通常依赖微信客户端流量监听、证书安装或流量解密，项目不内置这类方式；如果你能提供自己有权访问的直接媒体 URL，仍可按通用视频地址下载。';
  }
  if (/Sign in to confirm|login required|login to view|authentication required|HTTP Error 401|HTTP Error 403|HTTP 401|HTTP 403/i.test(output)) {
    const status = /401/.test(output) ? '401' : '403';
    return '站点返回 HTTP ' + status + '，可能需要登录或当前网络被拒绝。若你有权访问，请明确指定浏览器登录态后重试。';
  }
  if (/timed out|timeout|Temporary failure in name resolution|Name or service not known|Failed to resolve|Connection refused|Network is unreachable/i.test(output)) {
    return '连接视频站点超时或不可达。请检查设备网络及代理设置后重试。';
  }
  if (/Requested format is not available|No video formats found/i.test(output)) {
    return '站点未提供可用的视频格式。';
  }
  if (/File is larger than max-filesize|file is larger than max-filesize|exceeds max-filesize/i.test(output)) {
    return '视频超过 1 GiB 限制，未保存为下载结果。';
  }
  return '下载器未能取得该视频。请确认站点中的视频仍可播放，并更新下载器后重试。';
}

const MEDIA_EXTENSIONS = new Set(['.avi', '.flv', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm']);
const PUBLIC_MEDIA_RESOLVE_TIMEOUT_MS = 12_000;
/** Keep the downloader and video storage adapter on the same per-file limit. */
export const YTDLP_MAX_FILE_BYTES = 1024 * 1024 * 1024;
const SIZE_AWARE_DEFAULT_FORMAT = [
  'bestvideo[filesize<900M]+bestaudio[filesize<100M]',
  'bestvideo[filesize_approx<900M]+bestaudio[filesize_approx<100M]',
  'best[filesize<1G]',
  'best[filesize_approx<1G]',
  'bestvideo[height<=720]+bestaudio',
  'best[height<=720]',
  'bestvideo+bestaudio',
  'best',
].join('/');
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'host.docker.internal']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

function windowsUserYtDlpCommand() {
  const roots = [...new Set([
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.env.USERPROFILE,
    homedir(),
  ].filter((value): value is string => Boolean(value && value.trim())))];
  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const scanPythonDirectory = (directory: string) => {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Python\d+$/i.test(entry.name)) {
          addCandidate(path.join(directory, entry.name, 'Scripts', 'yt-dlp.exe'));
        }
      }
    } catch {
      // User-level Python installations are optional; continue with the next root.
    }
  };
  for (const root of roots) {
    for (const directory of [
      path.join(root, 'Python'),
      path.join(root, 'Programs', 'Python'),
      path.join(root, 'AppData', 'Roaming', 'Python'),
      path.join(root, 'AppData', 'Local', 'Programs', 'Python'),
    ]) scanPythonDirectory(directory);
    addCandidate(path.join(root, 'bin', 'yt-dlp.exe'));
    addCandidate(path.join(root, '.local', 'bin', 'yt-dlp.exe'));
  }
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function unixUserYtDlpCommand() {
  const home = homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'yt-dlp'),
    path.join(home, 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.13', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.12', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.11', 'bin', 'yt-dlp'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

/**
 * A release can carry yt-dlp inside its durable data directory.  Keeping the
 * executable next to the app's data makes a copied/portable installation work
 * on another computer without relying on that computer's user PATH.
 */
function bundledYtDlpCommand() {
  const binary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const dataDir = resolveLocalDataDir();
  const roots = [
    path.join(dataDir, 'tools'),
    path.join(process.cwd(), 'tools'),
    path.join(process.cwd(), 'bin'),
  ];
  const candidates = roots.flatMap((root) => [path.join(root, binary), path.join(root, 'yt-dlp', binary)]);
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function bundledYtDlpPath() {
  const binary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(resolveLocalDataDir(), 'tools', binary);
}

async function prepareBundledYtDlp() {
  const script = path.join(process.cwd(), 'scripts', 'ensure-ytdlp.mjs');
  if (!existsSync(script)) return false;
  try {
    const result = await spawnYtDlp({ command: process.execPath, args: [script, '--quiet'], cwd: process.cwd() });
    if (result.exitCode !== 0) return false;
    if (existsSync(bundledYtDlpPath())) return true;
    // The bootstrapper can fall back to an existing per-user Python install.
    // Verify that discovered command before treating that fallback as ready;
    // this keeps the runtime path independent from the current shell PATH.
    const discovered = configuredCommand();
    const probe = await spawnYtDlp({ command: discovered, args: ['--version'], cwd: process.cwd() });
    return probe.exitCode === 0 && /\d{4}\.\d+/m.test(probe.stdout);
  } catch {
    return false;
  }
}

function configuredCommand(explicit?: string) {
  const configured = String(explicit || process.env.SANMAO_YTDLP_PATH || process.env.YT_DLP_PATH || '').trim();
  // An absolute path may have belonged to the previous computer.  Treat a
  // missing configured file as stale and continue with the bundled/PATH
  // discovery below; command names such as `yt-dlp` still intentionally rely
  // on PATH resolution.
  if (configured && (!path.isAbsolute(configured) || existsSync(configured))) return configured;
  const bundled = bundledYtDlpCommand();
  if (bundled) return bundled;
  if (process.platform === 'win32') {
    const discovered = windowsUserYtDlpCommand();
    if (discovered) return discovered;
  } else {
    const discovered = unixUserYtDlpCommand();
    if (discovered) return discovered;
  }
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

/** Remove only partial artifacts created during this invocation. */
async function removeNewPartialFiles(outputDirectory: string, existingNames: ReadonlySet<string>) {
  let entries: string[];
  try {
    entries = readdirSync(outputDirectory);
  } catch {
    return;
  }
  const partials = entries.filter((name) => !existingNames.has(name) && /\.part(?:-Frag\d+)?$|\.ytdl$/i.test(name));
  await Promise.all(partials.map((name) => rm(path.join(outputDirectory, name), { force: true }).catch(() => undefined)));
}

/** Build the complete fixed argument list used for every download. */
export function buildYtDlpArguments(request: Pick<YtDlpDownloadRequest, 'url' | 'outputDirectory' | 'format' | 'ffmpegPath' | 'cookiesFromBrowser'> & {
  proxy?: string;
  mediaHeaders?: PublicMediaHeaders;
  outputId?: string;
}) {
  const url = assertHttpUrl(request.url);
  const outputDirectory = resolveOutputDirectory(request.outputDirectory);
  if (request.format !== undefined && request.format !== 'best' && request.format !== 'bestvideo+bestaudio/best') {
    throw new Error('不支持的视频格式选项。');
  }
  if (request.outputId && !/^[A-Za-z0-9_-]{1,128}$/.test(request.outputId)) {
    throw new Error('无效的视频输出标识。');
  }
  const format = request.format === 'best' || request.format === undefined
    ? SIZE_AWARE_DEFAULT_FORMAT
    : request.format;
  const args: string[] = [
    '--ignore-config',
    '--no-playlist',
    '--playlist-items', '1',
    // yt-dlp disables Node by default. The application already runs on Node,
    // so provide that runtime explicitly for current YouTube extraction.
    '--js-runtimes', `node:${process.execPath}`,
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
    '--output', request.outputId
      ? path.join(outputDirectory, `${request.outputId}.%(ext)s`)
      : outputTemplate(outputDirectory),
    // Favor a source combination that fits the storage limit. Some sites do
    // not report stream sizes; the height/standard fallbacks remain available
    // and the actual merged artifact is checked after download.
    '--format', format,
    '--merge-output-format', 'mp4',
  ];
  const ffmpegPath = String(request.ffmpegPath || '').trim();
  if (ffmpegPath) args.push('--ffmpeg-location', path.resolve(ffmpegPath));
  if (request.proxy) args.push('--proxy', request.proxy);
  if (request.mediaHeaders) {
    if (request.mediaHeaders.Range) args.push('--add-headers', `Range:${request.mediaHeaders.Range}`);
    args.push('--add-headers', `Referer:${request.mediaHeaders.Referer}`);
    if (request.mediaHeaders['User-Agent']) args.push('--add-headers', `User-Agent:${request.mediaHeaders['User-Agent']}`);
  }
  if (request.cookiesFromBrowser !== undefined) {
    const browser = resolveVideoDownloadBrowser(request.cookiesFromBrowser);
    args.push('--cookies-from-browser', browser);
  }
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

export async function downloadWithYtDlp(request: YtDlpDownloadRequest, dependencies: {
  command?: string;
  run?: YtDlpProcessRunner;
  resolveProxy?: typeof resolveVideoDownloadProxy;
  resolveXinpianchangMedia?: typeof resolveXinpianchangPublicMedia;
  resolveBilibiliMedia?: typeof resolveBilibiliPublicMedia;
} = {}): Promise<YtDlpDownloadResult> {
  const outputDirectory = resolveOutputDirectory(request.outputDirectory);
  const url = assertHttpUrl(request.url);
  await mkdir(outputDirectory, { recursive: true });
  const existingNames = new Set(readdirSync(outputDirectory));
  const command = configuredCommand(dependencies.command);
  const resolveProxy = dependencies.resolveProxy || resolveVideoDownloadProxy;
  const sourceProxy = await resolveProxy(url);
  let downloadUrl = url;
  let mediaHeaders: PublicMediaHeaders | undefined;
  let outputId: string | undefined;
  let publicMediaFailure: string | undefined;
  const xinpianchangWork = isXinpianchangVideoUrl(url);
  const bilibiliVideo = isBilibiliVideoUrl(url);
  if ((xinpianchangWork || bilibiliVideo) && !request.cookiesFromBrowser) {
    const mediaSignal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(PUBLIC_MEDIA_RESOLVE_TIMEOUT_MS)])
      : AbortSignal.timeout(PUBLIC_MEDIA_RESOLVE_TIMEOUT_MS);
    try {
      const media = xinpianchangWork
        ? await (dependencies.resolveXinpianchangMedia || resolveXinpianchangPublicMedia)(url, { signal: mediaSignal, proxy: sourceProxy })
        : await (dependencies.resolveBilibiliMedia || resolveBilibiliPublicMedia)(url, { signal: mediaSignal, proxy: sourceProxy });
      downloadUrl = media.mediaUrl;
      mediaHeaders = media.headers;
      outputId = media.id;
    } catch (error) {
      if (request.signal?.aborted) throw error;
      publicMediaFailure = mediaSignal.aborted
        ? '公开接口连接超时。'
        : error instanceof XinpianchangPublicMediaError || error instanceof BilibiliPublicMediaError
          ? error.message
          : '公开接口请求失败。';
    }
  }
  const downloadProxy = downloadUrl === url ? sourceProxy : await resolveProxy(downloadUrl);
  const args = buildYtDlpArguments({ ...request, url: downloadUrl, outputDirectory, proxy: downloadProxy, mediaHeaders, outputId });
  const run = dependencies.run || spawnYtDlp;
  let processResult: YtDlpProcessResult;
  try {
    processResult = await run({ command, args, cwd: outputDirectory, signal: request.signal, onOutput: request.onProgress });
  } catch (error) {
    await removeNewPartialFiles(outputDirectory, existingNames);
    if (request.signal?.aborted) throw request.signal.reason || new Error('yt-dlp 下载已取消。');
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    if (code === 'ENOENT' && !dependencies.command) {
      const prepared = await prepareBundledYtDlp();
      if (prepared) {
        const preparedCommand = bundledYtDlpCommand() || configuredCommand();
        processResult = await run({ command: preparedCommand, args, cwd: outputDirectory, signal: request.signal, onOutput: request.onProgress });
      } else {
        throw new YtDlpUnavailableError('视频下载技能已启用，但自动准备 yt-dlp 失败。请检查网络后重新启动 SANMAO.AI，或将 yt-dlp.exe 放入 .data/tools/。');
      }
    } else if (code === 'ENOENT') {
      throw new YtDlpUnavailableError();
    } else {
      throw error;
    }
  }
  if (request.signal?.aborted) {
    await removeNewPartialFiles(outputDirectory, existingNames);
    throw request.signal.reason || new Error('yt-dlp 下载已取消。');
  }
  if (processResult.exitCode !== 0) {
    await removeNewPartialFiles(outputDirectory, existingNames);
    const fallbackFailure = summarizeYtDlpFailure(processResult.stderr, processResult.stdout, url);
    const message = publicMediaFailure
      ? `公开媒体解析失败（${publicMediaFailure}）；备用下载也失败：${fallbackFailure}`
      : fallbackFailure;
    throw new YtDlpDownloadError(message, {
      exitCode: processResult.exitCode,
      stderr: processResult.stderr,
    });
  }
  const file = await findPrintedFile(processResult.stdout, outputDirectory);
  if (!file) {
    await removeNewPartialFiles(outputDirectory, existingNames);
    throw new YtDlpDownloadError('yt-dlp 已结束，但没有找到输出视频文件。', { exitCode: processResult.exitCode, stderr: processResult.stderr });
  }
  // `--max-filesize` is evaluated by yt-dlp while selecting/downloading a
  // source. A video and audio stream can still exceed the limit after ffmpeg
  // merges them, so enforce the limit on the actual returned artifact before
  // exposing it through the storage route.
  if (file.bytes > YTDLP_MAX_FILE_BYTES) {
    // `--no-overwrites` may return an existing file. Do not remove media that
    // was already in the library before this download began.
    if (!existingNames.has(path.basename(file.filePath))) await rm(file.filePath, { force: true });
    throw new YtDlpDownloadError('视频超过 1 GiB 限制，未保存为下载结果。', { exitCode: processResult.exitCode, stderr: processResult.stderr });
  }
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


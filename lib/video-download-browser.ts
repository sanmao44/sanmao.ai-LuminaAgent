import path from 'node:path';
import { existsSync } from 'node:fs';
import { browserNameFromPath, detectDefaultBrowserExecutable, resolveUserDataDir } from './mcp/browser-extension';
import { isVideoDownloadBrowserSession, type VideoDownloadBrowserSession } from '@/packages/contracts/video-download';

/**
 * yt-dlp needs a concrete browser name. `default` is only the user-facing
 * authorization alias and is resolved at the download boundary.
 */
/** A yt-dlp browser name, optionally followed by a custom Chromium profile root. */
export type ResolvedVideoDownloadBrowser = Exclude<VideoDownloadBrowserSession, 'default'> | `chrome:${string}`;

const EXECUTABLE_BROWSER_NAMES: Record<string, ResolvedVideoDownloadBrowser> = {
  'brave': 'brave',
  'brave-browser': 'brave',
  'brave.exe': 'brave',
  'chrome': 'chrome',
  'chrome.exe': 'chrome',
  'chromium': 'chromium',
  'chromium.exe': 'chromium',
  'edge': 'edge',
  'msedge': 'edge',
  'msedge.exe': 'edge',
  'firefox': 'firefox',
  'firefox.exe': 'firefox',
  'opera': 'opera',
  'opera.exe': 'opera',
  'safari': 'safari',
  'vivaldi': 'vivaldi',
  'vivaldi.exe': 'vivaldi',
  'whale': 'whale',
  'whale.exe': 'whale',
};

function browserNameFromExecutable(executable: string) {
  const base = path.basename(executable.replaceAll('\\', '/')).toLowerCase();
  const direct = EXECUTABLE_BROWSER_NAMES[base];
  if (direct) return direct;
  const displayName = browserNameFromPath(executable).toLowerCase();
  if (displayName.includes('chrome')) return 'chrome';
  if (displayName.includes('edge')) return 'edge';
  if (displayName.includes('firefox')) return 'firefox';
  if (displayName.includes('brave')) return 'brave';
  if (displayName.includes('chromium')) return 'chromium';
  if (displayName.includes('vivaldi')) return 'vivaldi';
  return undefined;
}

function customChromiumProfileRoot(executable: string, platform: string, localAppData = process.env.LOCALAPPDATA || '') {
  if (platform !== 'win32' || !localAppData) return null;
  const displayName = browserNameFromPath(executable).trim();
  if (!displayName) return null;
  const names = [...new Set([
    displayName,
    displayName.replace(/\s+/g, ''),
    displayName.split(/\s+/)[0],
  ])];
  return names
    .map((name) => path.join(localAppData, name, 'User Data'))
    .find((candidate) => existsSync(candidate)) || null;
}

export function resolveVideoDownloadBrowser(
  value: VideoDownloadBrowserSession,
  options: {
    platform?: string;
    detectDefault?: (platform: string) => string | null;
    localAppData?: string;
  } = {},
): ResolvedVideoDownloadBrowser {
  if (!isVideoDownloadBrowserSession(value)) throw new Error('Unsupported browser session for video download.');
  if (value !== 'default') return value;
  const detectDefault = options.detectDefault || detectDefaultBrowserExecutable;
  const executable = detectDefault(options.platform || process.platform);
  const browser = executable ? browserNameFromExecutable(executable) : undefined;
  if (browser) return browser;

  // yt-dlp can read a Chromium-compatible profile by path even when the
  // executable belongs to a branded Chromium browser (for example Tabbit).
  // This keeps “default browser” useful without inventing a new cookie reader.
  const platform = options.platform || process.platform;
  const profileRoot = executable
    ? resolveUserDataDir(executable, platform)
      || customChromiumProfileRoot(executable, platform, options.localAppData)
    : null;
  if (profileRoot) return `chrome:${profileRoot}`;

  if (!executable) {
    throw new Error('无法识别系统默认浏览器。请明确指定 Chrome、Edge、Firefox 等浏览器后重试。');
  }
  throw new Error('系统默认浏览器不是 yt-dlp 支持的浏览器，且无法定位其 Chromium profile。请指定 Chrome 或 Firefox 会话后重试。');
}

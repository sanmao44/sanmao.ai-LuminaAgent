export const VIDEO_DOWNLOAD_BROWSER_SESSIONS = [
  'default',
  'brave',
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'opera',
  'safari',
  'vivaldi',
  'whale',
] as const;

export type VideoDownloadBrowserSession = typeof VIDEO_DOWNLOAD_BROWSER_SESSIONS[number];

export function isVideoDownloadBrowserSession(value: unknown): value is VideoDownloadBrowserSession {
  return typeof value === 'string'
    && (VIDEO_DOWNLOAD_BROWSER_SESSIONS as readonly string[]).includes(value);
}

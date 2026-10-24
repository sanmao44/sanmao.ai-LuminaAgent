import { isIP } from 'node:net';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const XINPIANCHANG_ORIGIN = 'https://www.xinpianchang.com';
const MEDIA_API_ORIGIN = 'https://mod-api.xinpianchang.com';
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const BLOCKED_MEDIA_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'host.docker.internal']);
const BLOCKED_MEDIA_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

export type XinpianchangPublicMedia = {
  sourceUrl: string;
  mediaUrl: string;
  id: string;
  quality: string;
  filesize: number;
  mimeType: string;
  headers: Readonly<{ Range: string; Referer: string }>;
};

export type XinpianchangPublicMediaOptions = {
  fetcher?: typeof fetch;
  proxy?: string;
  signal?: AbortSignal;
};

export class XinpianchangPublicMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XinpianchangPublicMediaError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function workIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || !['www.xinpianchang.com', 'xinpianchang.com'].includes(url.hostname.toLowerCase())
    || url.port || url.username || url.password) return null;
  return /^\/a([1-9]\d*)\/?$/.exec(url.pathname)?.[1] ?? null;
}

export function isXinpianchangVideoUrl(value: string): boolean {
  return workIdFromUrl(value) !== null;
}

function parseBuildId(html: string): string {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html)?.[1];
  if (!script) throw new XinpianchangPublicMediaError('新片场首页未返回作品数据版本。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(script);
  } catch {
    throw new XinpianchangPublicMediaError('新片场首页作品数据无效。');
  }
  const buildId = record(parsed)?.buildId;
  if (typeof buildId !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(buildId)) {
    throw new XinpianchangPublicMediaError('新片场首页作品数据版本无效。');
  }
  return buildId;
}

async function readText(fetcher: typeof fetch, url: string, accept: string, signal: AbortSignal | undefined, proxy?: string): Promise<string> {
  let dispatcher: ProxyAgent | undefined;
  let consumed = false;
  try {
    let response: Response;
    if (proxy && fetcher === fetch) {
      dispatcher = new ProxyAgent(proxy);
      const proxied = await undiciFetch(url, { method: 'GET', redirect: 'error', headers: { Accept: accept }, signal, dispatcher });
      response = proxied as unknown as Response;
    } else {
      response = await fetcher(url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: accept },
        signal,
      });
    }
    if (!response.ok) throw new XinpianchangPublicMediaError(`新片场公开媒体接口返回 HTTP ${response.status}。`);
    const body = await response.text();
    consumed = true;
    return body;
  } catch (error) {
    if (signal?.aborted || error instanceof XinpianchangPublicMediaError) throw error;
    throw new XinpianchangPublicMediaError('无法连接新片场公开媒体接口。');
  } finally {
    if (dispatcher) {
      if (consumed) await dispatcher.close();
      else await dispatcher.destroy();
    }
  }
}

async function readJson(fetcher: typeof fetch, url: string, signal: AbortSignal | undefined, proxy?: string): Promise<unknown> {
  const body = await readText(fetcher, url, 'application/json', signal, proxy);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new XinpianchangPublicMediaError('新片场公开媒体接口返回了无效数据。');
  }
}

function publicMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || isIP(host.replace(/^\[|\]$/g, '')) !== 0
      || BLOCKED_MEDIA_HOSTS.has(host)
      || BLOCKED_MEDIA_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Resolve only the anonymously exposed progressive stream; no browser session is read. */
export async function resolveXinpianchangPublicMedia(
  sourceUrl: string,
  options: XinpianchangPublicMediaOptions = {},
): Promise<XinpianchangPublicMedia> {
  const workId = workIdFromUrl(sourceUrl);
  if (!workId) throw new XinpianchangPublicMediaError('仅支持新片场作品链接（/a数字）。');
  const canonicalUrl = `${XINPIANCHANG_ORIGIN}/a${workId}`;
  const fetcher = options.fetcher ?? fetch;

  const buildId = parseBuildId(await readText(fetcher, `${XINPIANCHANG_ORIGIN}/`, 'text/html', options.signal, options.proxy));
  const nextData = record(await readJson(
    fetcher,
    `${XINPIANCHANG_ORIGIN}/_next/data/${buildId}/a${workId}.json`,
    options.signal,
    options.proxy,
  ));
  const detail = record(record(nextData?.pageProps)?.detail);
  const video = record(detail?.video);
  const vid = video?.vid;
  const appKey = video?.appKey;
  if (detail?.id !== Number(workId)
    || typeof vid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(vid)
    || typeof appKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(appKey)) {
    throw new XinpianchangPublicMediaError('新片场作品数据缺少有效媒体标识。');
  }

  const mediaApiUrl = new URL(`/mod/api/v2/media/${encodeURIComponent(vid)}`, MEDIA_API_ORIGIN);
  mediaApiUrl.searchParams.set('appKey', appKey);
  const media = record(await readJson(fetcher, mediaApiUrl.toString(), options.signal, options.proxy));
  const data = record(media?.data);
  const progressive = record(data?.resource)?.progressive;
  if (media?.status !== 0 || data?.private !== 0 || !Array.isArray(progressive)) {
    throw new XinpianchangPublicMediaError('新片场未提供公开的可下载媒体。');
  }

  const candidates = progressive.flatMap((item) => {
    const format = record(item);
    const mediaUrl = publicMediaUrl(format?.url);
    const filesize = format?.filesize;
    const mimeType = format?.mime;
    if (!mediaUrl || typeof filesize !== 'number' || !Number.isSafeInteger(filesize)
      || filesize <= 0 || filesize > MAX_VIDEO_BYTES
      || typeof mimeType !== 'string' || !mimeType.startsWith('video/')) return [];
    return [{
      mediaUrl,
      filesize,
      mimeType,
      quality: typeof format?.quality === 'string' ? format.quality : '',
      bitrate: typeof format?.bitrate === 'number' && Number.isFinite(format.bitrate) ? format.bitrate : 0,
      height: typeof format?.height === 'number' && Number.isFinite(format.height) ? format.height : 0,
    }];
  });
  candidates.sort((left, right) => right.bitrate - left.bitrate || right.height - left.height || right.filesize - left.filesize);
  const selected = candidates[0];
  if (!selected) throw new XinpianchangPublicMediaError('新片场未提供 1 GiB 以内的公开渐进式视频。');

  return {
    sourceUrl: canonicalUrl,
    mediaUrl: selected.mediaUrl,
    id: `a${workId}`,
    quality: selected.quality,
    filesize: selected.filesize,
    mimeType: selected.mimeType,
    headers: { Range: 'bytes=0-', Referer: canonicalUrl },
  };
}

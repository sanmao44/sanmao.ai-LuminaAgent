import { isIP } from 'node:net';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const BILIBILI_ORIGIN = 'https://www.bilibili.com';
const BILIBILI_API_ORIGIN = 'https://api.bilibili.com';
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0';
const BLOCKED_MEDIA_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'host.docker.internal']);
const BLOCKED_MEDIA_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

export type BilibiliPublicMedia = {
  sourceUrl: string;
  mediaUrl: string;
  id: string;
  quality: number;
  filesize: number;
  mimeType: 'video/mp4';
  headers: Readonly<{ Referer: string; 'User-Agent': string }>;
};

export type BilibiliPublicMediaOptions = {
  fetcher?: typeof fetch;
  proxy?: string;
  signal?: AbortSignal;
};

export class BilibiliPublicMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BilibiliPublicMediaError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function videoFromUrl(value: string): { bvid: string; page: number } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)
    || !['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname.toLowerCase())
    || url.port || url.username || url.password) return null;
  const bvid = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname)?.[1];
  if (!bvid) return null;
  const pages = url.searchParams.getAll('p');
  if (pages.length > 1 || (pages.length === 1 && !/^[1-9]\d{0,2}$/.test(pages[0]))) return null;
  return { bvid, page: pages.length ? Number(pages[0]) : 1 };
}

export function isBilibiliVideoUrl(value: string): boolean {
  return videoFromUrl(value) !== null;
}

function publicMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || isIP(host.replace(/^\[|\]$/g, '')) !== 0
      || BLOCKED_MEDIA_HOSTS.has(host)
      || BLOCKED_MEDIA_SUFFIXES.some((suffix) => host.endsWith(suffix))
      || !url.pathname.toLowerCase().endsWith('.mp4')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function readJson(
  fetcher: typeof fetch,
  url: string,
  referer: string,
  signal: AbortSignal | undefined,
  proxy?: string,
): Promise<unknown> {
  let dispatcher: ProxyAgent | undefined;
  let consumed = false;
  try {
    const headers = { Accept: 'application/json', Referer: referer, 'User-Agent': USER_AGENT };
    let response: Response;
    if (proxy && fetcher === fetch) {
      dispatcher = new ProxyAgent(proxy);
      response = await undiciFetch(url, { method: 'GET', redirect: 'error', headers, signal, dispatcher }) as unknown as Response;
    } else {
      response = await fetcher(url, { method: 'GET', credentials: 'omit', redirect: 'error', headers, signal });
    }
    if (!response.ok) throw new BilibiliPublicMediaError(`Bilibili 公开接口返回 HTTP ${response.status}。`);
    const result: unknown = await response.json();
    consumed = true;
    return result;
  } catch (error) {
    if (signal?.aborted || error instanceof BilibiliPublicMediaError) throw error;
    throw new BilibiliPublicMediaError('无法读取 Bilibili 公开媒体接口。');
  } finally {
    if (dispatcher) {
      if (consumed) await dispatcher.close();
      else await dispatcher.destroy();
    }
  }
}

/** Resolve one anonymously available progressive MP4; yt-dlp downloads the returned URL. */
export async function resolveBilibiliPublicMedia(
  sourceUrl: string,
  options: BilibiliPublicMediaOptions = {},
): Promise<BilibiliPublicMedia> {
  const video = videoFromUrl(sourceUrl);
  if (!video) throw new BilibiliPublicMediaError('仅支持 Bilibili 单个 BV 视频链接。');
  const canonicalUrl = `${BILIBILI_ORIGIN}/video/${video.bvid}/${video.page > 1 ? `?p=${video.page}` : ''}`;
  const fetcher = options.fetcher ?? fetch;
  const viewUrl = new URL('/x/web-interface/view', BILIBILI_API_ORIGIN);
  viewUrl.searchParams.set('bvid', video.bvid);
  const view = record(await readJson(fetcher, viewUrl.toString(), canonicalUrl, options.signal, options.proxy));
  const details = record(view?.data);
  const rights = record(details?.rights);
  if (view?.code !== 0 || details?.bvid !== video.bvid || !rights
    || rights.pay !== 0 || rights.ugc_pay !== 0 || rights.arc_pay !== 0
    || rights.ugc_pay_preview === 1
    || details?.is_upower_exclusive === true || details?.is_upower_exclusive === 1) {
    throw new BilibiliPublicMediaError('Bilibili 未提供公开可下载的作品信息。');
  }

  const pages = details.pages;
  const part = Array.isArray(pages) ? record(pages[video.page - 1]) : null;
  const cid = part?.cid ?? (video.page === 1 ? details.cid : undefined);
  if (!Number.isSafeInteger(cid) || typeof cid !== 'number' || cid <= 0
    || (part && part.page !== video.page)) {
    throw new BilibiliPublicMediaError('Bilibili 未提供请求的单视频分 P。');
  }

  const playUrl = new URL('/x/player/playurl', BILIBILI_API_ORIGIN);
  playUrl.searchParams.set('bvid', video.bvid);
  playUrl.searchParams.set('cid', String(cid));
  playUrl.searchParams.set('qn', '80');
  playUrl.searchParams.set('fnval', '1');
  const play = record(await readJson(fetcher, playUrl.toString(), canonicalUrl, options.signal, options.proxy));
  const media = record(play?.data);
  const segments = media?.durl;
  const segment = Array.isArray(segments) && segments.length === 1 ? record(segments[0]) : null;
  const mediaUrls = [segment?.url, ...(Array.isArray(segment?.backup_url) ? segment.backup_url : [])];
  const mediaUrl = mediaUrls.map(publicMediaUrl).find((url): url is string => Boolean(url));
  const filesize = segment?.size;
  if (play?.code !== 0 || !segment || media?.is_drm === true || media?.is_drm === 1
    || !mediaUrl || typeof filesize !== 'number' || !Number.isSafeInteger(filesize)
    || filesize <= 0 || filesize > MAX_VIDEO_BYTES) {
    throw new BilibiliPublicMediaError('Bilibili 未提供 1 GiB 内的公开单段 MP4 视频。');
  }

  return {
    sourceUrl: canonicalUrl,
    mediaUrl,
    id: `${video.bvid}${video.page > 1 ? `_p${video.page}` : ''}`,
    quality: typeof media?.quality === 'number' ? media.quality : 0,
    filesize,
    mimeType: 'video/mp4',
    headers: { Referer: canonicalUrl, 'User-Agent': USER_AGENT },
  };
}

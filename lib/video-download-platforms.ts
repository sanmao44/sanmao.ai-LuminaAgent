/**
 * URL classification used only to improve downloader diagnostics.
 *
 * The actual extraction remains owned by yt-dlp. These predicates deliberately
 * do not claim that a site is downloadable; they identify known share-page
 * families so the adapter can explain a platform-specific failure accurately.
 */

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isHostOrSubdomain(hostname: string, root: string) {
  return hostname === root || hostname.endsWith(`.${root}`);
}

/** Official yt-dlp has a Douyin extractor; this covers direct and short-share URLs. */
export function isDouyinVideoUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url || url.port || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  return isHostOrSubdomain(hostname, 'douyin.com')
    || isHostOrSubdomain(hostname, 'iesdouyin.com');
}

/**
 * WeChat Channels share pages are not the same as a direct finder.video.qq.com
 * media URL. The latter remains eligible for the generic downloader.
 */
export function isWeixinChannelsShareUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url || url.port || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  if (isHostOrSubdomain(hostname, 'channels.weixin.qq.com')) return true;
  if (hostname === 'weixin.qq.com' || hostname === 'www.weixin.qq.com') {
    return /^\/sph(?:\/|$)/i.test(url.pathname)
      || /(?:^|\/)channels?(?:\/|$)/i.test(url.pathname);
  }
  return false;
}

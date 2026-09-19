import { createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'sanmao_admin';

export type SanmaoNetworkMode = 'local' | 'lan';

function isLoopbackRequest(request: Request) {
  try {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch { return false; }
}

function configuredPassword() {
  return process.env.SANMAO_ADMIN_PASSWORD?.trim() || '';
}

/**
 * 跨站请求识别。本机模式没有密码时，任何网页都能往 127.0.0.1:3210 发请求——
 * 浏览器不会拦（请求确实到得了本机），所以必须由服务端确认请求来自同源页面，
 * 否则一个恶意网页就能往本机 API 里塞 MCP 服务配置、改设置、读工作区。
 *
 * 只拦浏览器标记出来的 http(s) 来源：命令行和脚本不带 Origin，
 * 桌面外壳用自定义协议时 Origin 也不是 http(s)，这些都不受影响。
 *
 * 副作用：sandbox 预览 iframe（opaque origin）发起的请求同样算跨站。预览内容必须自带资源
 * （目前图片都内联成 data: URL），不能在预览页里直接调 /api/*。
 */
export function isCrossSiteBrowserRequest(request: Request) {
  if (String(request.headers.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false;
  }
  if (from.protocol !== 'http:' && from.protocol !== 'https:') return false;
  // 反向代理会改写 Host，但通常会把原始站点写在 X-Forwarded-Host 里。
  // 跨站请求要带上这个自定义头必须过 CORS 预检，本服务不发 CORS 头，所以这里可以信它。
  const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  if (forwardedHost && forwardedHost === from.host) return false;
  try {
    return from.host !== new URL(request.url).host;
  } catch {
    return false;
  }
}

export function networkMode(): SanmaoNetworkMode {
  return process.env.SANMAO_NETWORK_MODE === 'lan' ? 'lan' : 'local';
}

function expectedToken() {
  const password = configuredPassword();
  if (!password) return '';
  return createHash('sha256').update(`SANMAO.AI:${password}`).digest('hex');
}

function parseCookie(header: string | null, name: string) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function adminProtectionEnabled() {
  return networkMode() === 'lan' || Boolean(configuredPassword());
}

export function isAdminRequest(request: Request) {
  if (isCrossSiteBrowserRequest(request)) return false;
  if (!adminProtectionEnabled()) return isLoopbackRequest(request);
  const actual = parseCookie(request.headers.get('cookie'), COOKIE);
  const expected = expectedToken();
  if (!actual || actual.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); } catch { return false; }
}

export function isTrustedAppRequest(request: Request) {
  // 这里也要先拦跨站：回环地址判断只看请求 URL，别的网页照样能构造出回环请求。
  if (isCrossSiteBrowserRequest(request)) return false;
  return isLoopbackRequest(request) || isAdminRequest(request);
}

export function verifyAdminPassword(value: string) {
  const configured = configuredPassword();
  if (!configured) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function adminCookie(request: Request) {
  const secure = request.headers.get('x-forwarded-proto') === 'https:' || new URL(request.url).protocol === 'https:';
  return `${COOKIE}=${expectedToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`;
}

export function clearAdminCookie(request: Request) {
  const secure = request.headers.get('x-forwarded-proto') === 'https:' || new URL(request.url).protocol === 'https:';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

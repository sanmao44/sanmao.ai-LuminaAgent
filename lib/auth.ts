import { createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'sanmao_admin';

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
  return Boolean(configuredPassword());
}

export function isAdminRequest(request: Request) {
  if (!adminProtectionEnabled()) return isLoopbackRequest(request);
  const actual = parseCookie(request.headers.get('cookie'), COOKIE);
  const expected = expectedToken();
  if (!actual || actual.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); } catch { return false; }
}

export function isTrustedAppRequest(request: Request) {
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

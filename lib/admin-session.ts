const ADMIN_SESSION_CACHE_KEY = 'sanmao.admin-session.v1';
const ADMIN_SESSION_CACHE_TTL_MS = 30_000;

export type AdminSession = {
  required: boolean;
  authenticated: boolean;
};

function readCachedAdminSessionValue(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(ADMIN_SESSION_CACHE_KEY) || 'null') as {
      at?: unknown;
      session?: Partial<AdminSession>;
    } | null;
    if (!value || Date.now() - Number(value.at || 0) > ADMIN_SESSION_CACHE_TTL_MS) return null;
    if (typeof value.session?.required !== 'boolean' || typeof value.session.authenticated !== 'boolean') return null;
    return value.session as AdminSession;
  } catch {
    return null;
  }
}

function cacheAdminSession(session: AdminSession) {
  try {
    window.localStorage.setItem(ADMIN_SESSION_CACHE_KEY, JSON.stringify({ at: Date.now(), session }));
  } catch {
    // Storage being unavailable must not block the access check.
  }
}

export async function requestAdminSession() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({})) as Partial<AdminSession> & { error?: string };
    if (!response.ok) throw new Error(data.error || '访问权限检查失败');
    const session: AdminSession = {
      required: Boolean(data.required),
      authenticated: Boolean(data.authenticated),
    };
    cacheAdminSession(session);
    return session;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function readCachedAdminSession() {
  return readCachedAdminSessionValue();
}

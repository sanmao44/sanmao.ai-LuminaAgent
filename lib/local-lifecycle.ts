const HEARTBEAT_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 3_000;
const CLEANUP_INTERVAL_MS = 2_000;
// The launcher starts the server before the browser page can finish loading
// and send its first heartbeat. Keep a short startup lease so the server does
// not exit during that hand-off window.
const STARTUP_GRACE_MS = 30_000;

const sessions = new Map<string, number>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
const lifecycleStartedAt = Date.now();

export function isLocalLifecycleEnabled() {
  return process.env.SANMAO_LIFECYCLE === '1';
}

function clearShutdownTimer() {
  if (!shutdownTimer) return;
  clearTimeout(shutdownTimer);
  shutdownTimer = null;
}

function scheduleShutdown() {
  if (!isLocalLifecycleEnabled() || sessions.size > 0 || shutdownTimer) return;
  const elapsed = Date.now() - lifecycleStartedAt;
  const delay = elapsed < STARTUP_GRACE_MS
    ? STARTUP_GRACE_MS - elapsed + SHUTDOWN_GRACE_MS
    : SHUTDOWN_GRACE_MS;
  shutdownTimer = setTimeout(() => {
    shutdownTimer = null;
    removeExpiredSessions();
    if (sessions.size === 0 && isLocalLifecycleEnabled()) process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}

function removeExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, lastSeen] of sessions) {
    if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) sessions.delete(sessionId);
  }
  if (sessions.size === 0) scheduleShutdown();
}

function ensureCleanupTimer() {
  if (cleanupTimer || !isLocalLifecycleEnabled()) return;
  cleanupTimer = setInterval(removeExpiredSessions, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function touchLocalSession(sessionId: string) {
  if (!isLocalLifecycleEnabled()) return;
  clearShutdownTimer();
  sessions.set(sessionId, Date.now());
  ensureCleanupTimer();
}

export function releaseLocalSession(sessionId: string) {
  if (!isLocalLifecycleEnabled()) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) scheduleShutdown();
}

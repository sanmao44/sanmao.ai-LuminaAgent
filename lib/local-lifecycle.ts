// A browser can pause timers while a tab is backgrounded or while the
// computer is waking from sleep. This lease is only used to discard stale
// session records; it must never be used to terminate the local server.
const HEARTBEAT_TIMEOUT_MS = 60_000;
const CLEANUP_INTERVAL_MS = 10_000;

const sessions = new Map<string, number>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function isLocalLifecycleEnabled() {
  return process.env.SANMAO_LIFECYCLE === '1';
}

function stopCleanupTimer() {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}

function removeExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, lastSeen] of sessions) {
    if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) sessions.delete(sessionId);
  }
  if (sessions.size === 0) stopCleanupTimer();
}

function ensureCleanupTimer() {
  if (cleanupTimer || !isLocalLifecycleEnabled()) return;
  cleanupTimer = setInterval(removeExpiredSessions, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function touchLocalSession(sessionId: string) {
  if (!isLocalLifecycleEnabled()) return;
  sessions.set(sessionId, Date.now());
  ensureCleanupTimer();
}

export function releaseLocalSession(sessionId: string) {
  if (!isLocalLifecycleEnabled()) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) stopCleanupTimer();
}

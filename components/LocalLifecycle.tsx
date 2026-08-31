"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 2_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

/**
 * Reports local browser usage for maintenance tasks such as automatic
 * snapshots. The local launcher-owned server intentionally stays available
 * even when a browser tab is backgrounded or temporarily disconnected; LAN
 * and development servers remain unaffected when the capability endpoint
 * reports disabled.
 */
export default function LocalLifecycle() {
  useEffect(() => {
    let cancelled = false;
    let active = false;
    let starting = false;
    let sessionId = "";
    let heartbeatTimer: number | null = null;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    let retryRequested = false;

    const postHeartbeat = async () => {
      if (!sessionId) return;
      const response = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, event: "heartbeat" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Lifecycle heartbeat failed: ${response.status}`);
    };

    const clearHeartbeatTimer = () => {
      if (heartbeatTimer === null) return;
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const scheduleStart = () => {
      if (cancelled || active || retryTimer !== null) return;
      if (starting) {
        retryRequested = true;
        return;
      }
      const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void start();
      }, delay);
    };

    const heartbeat = async () => {
      if (!active || !sessionId) return;
      try {
        await postHeartbeat();
        retryAttempt = 0;
      } catch {
        active = false;
        sessionId = "";
        clearHeartbeatTimer();
        scheduleStart();
      }
    };

    const startHeartbeat = () => {
      clearHeartbeatTimer();
      heartbeatTimer = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
      void heartbeat();
    };

    const start = async () => {
      if (cancelled || active || starting) return;
      starting = true;
      try {
        const response = await fetch("/api/lifecycle", { cache: "no-store" });
        if (!response.ok) throw new Error(`Lifecycle probe failed: ${response.status}`);
        const data = await response.json() as { enabled?: unknown };
        if (cancelled || data.enabled !== true) return;
        sessionId = crypto.randomUUID();
        active = true;
        retryAttempt = 0;
        startHeartbeat();
      } catch {
        // Lifecycle support is optional; retry a transient startup failure
        // without affecting the rest of the application.
        scheduleStart();
      } finally {
        starting = false;
        if (retryRequested) {
          retryRequested = false;
          scheduleStart();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (active) void heartbeat();
      else void start();
    };

    const handleOnline = () => {
      if (active) void heartbeat();
      else void start();
    };

    // Do not close the session from pagehide/unmount. Browsers fire pagehide
    // for reloads as well as tab/window closes, so an unload beacon can stop
    // the local server before the newly refreshed page has mounted. The
    // server-side heartbeat lease expires naturally when the page disappears.
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    void start();

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}

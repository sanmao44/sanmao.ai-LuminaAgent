"use client";

import { useEffect } from "react";

type LifecycleEvent = "heartbeat" | "close";

/**
 * Keeps a local launcher-owned server alive while at least one browser page
 * is using it. The server explicitly opts into this protocol through the
 * SANMAO_LIFECYCLE environment variable; LAN and development servers remain
 * unaffected when the capability endpoint reports disabled.
 */
export default function LocalLifecycle() {
  useEffect(() => {
    let cancelled = false;
    let active = false;
    let closed = false;
    let sessionId = "";
    let heartbeatTimer: number | null = null;

    const postEvent = (event: LifecycleEvent, keepalive = false) => {
      if (!sessionId) return;
      void fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, event }),
        cache: "no-store",
        keepalive,
      }).catch(() => undefined);
    };

    const heartbeat = () => {
      if (!active || closed) return;
      postEvent("heartbeat");
    };

    const closeSession = () => {
      if (!active || closed || !sessionId) return;
      closed = true;
      const body = new Blob([
        JSON.stringify({ sessionId, event: "close" }),
      ], { type: "application/json" });
      if (!navigator.sendBeacon("/api/lifecycle", body)) postEvent("close", true);
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      // A BFCache navigation temporarily hides the page but does not close
      // the document. Keep the session alive until pageshow restores it.
      if (event.persisted) return;
      closeSession();
    };

    const handlePageShow = () => {
      if (!active || !closed) return;
      closed = false;
      heartbeat();
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    const start = async () => {
      try {
        const response = await fetch("/api/lifecycle", { cache: "no-store" });
        const data = await response.json() as { enabled?: unknown };
        if (cancelled || !response.ok || data.enabled !== true) return;
        sessionId = crypto.randomUUID();
        active = true;
        heartbeat();
        heartbeatTimer = window.setInterval(heartbeat, 2_000);
      } catch {
        // Lifecycle support is optional; a failed probe must not affect the
        // rest of the application.
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      closeSession();
    };
  }, []);

  return null;
}

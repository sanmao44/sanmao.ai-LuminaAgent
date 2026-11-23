"use client";

import { useEffect, type RefObject } from "react";

export function agentInputMaxHeight(width: number, height: number, visualViewportHeight?: number): number {
  if (width > 780) return 320;
  const heights = [height, visualViewportHeight].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  const availableHeight = heights.length ? Math.min(...heights) : 190 / 0.3;
  return Math.max(58, Math.min(190, Math.floor(availableHeight * 0.3)));
}

/** Sizes the Agent composer after its editor mounts and as the visible viewport changes. */
export function useAgentInputAutosize(inputRef: RefObject<HTMLDivElement | null>, value: string, active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const input = inputRef.current;
    if (!input) return;
    const viewport = window.visualViewport;
    const update = () => {
      input.style.height = "auto";
      const borderHeight = Math.max(0, input.offsetHeight - input.clientHeight);
      const maxHeight = agentInputMaxHeight(window.innerWidth, window.innerHeight, viewport?.height);
      input.style.height = `${Math.min(Math.max(input.scrollHeight + borderHeight, 58), maxHeight)}px`;
      // CSS may impose a larger minimum than the calculated height; compare the rendered box.
      input.style.overflowY = input.scrollHeight > input.clientHeight + 1 ? "auto" : "hidden";
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
    };
  }, [inputRef, value, active]);
}

'use client';

import { useEffect } from 'react';

type ScrollLockSnapshot = {
  htmlOverflow: string;
  bodyOverflow: string;
  bodyPaddingRight: string;
};

let activeLocks = 0;
let snapshot: ScrollLockSnapshot | null = null;

function lockBodyScroll() {
  if (typeof document === 'undefined') return () => undefined;

  if (activeLocks === 0) {
    const html = document.documentElement;
    const body = document.body;
    snapshot = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };

    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
  }

  activeLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks > 0 || !snapshot) return;

    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = snapshot.htmlOverflow;
    body.style.overflow = snapshot.bodyOverflow;
    body.style.paddingRight = snapshot.bodyPaddingRight;
    snapshot = null;
  };
}

/** Prevents wheel/touch scroll from reaching the page while an overlay is open. */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined;
    return lockBodyScroll();
  }, [locked]);
}

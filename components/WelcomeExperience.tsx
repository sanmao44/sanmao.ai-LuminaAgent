'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

export const WELCOME_SEEN_STORAGE_KEY = 'sanmao-welcome-seen-v1';

type WelcomeExperienceProps = {
  theme: 'light' | 'dark';
  onEnter: () => void;
};

export default function WelcomeExperience({ theme, onEnter }: WelcomeExperienceProps) {
  const [leaving, setLeaving] = useState(false);
  const [pointer, setPointer] = useState({ x: 50, y: 43, offsetX: 0, offsetY: 0 });
  const leavingRef = useRef(false);
  const onEnterRef = useRef(onEnter);
  const enterTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  const enterWorkspace = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      window.localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
    } catch {
      // The current session still continues when localStorage is unavailable.
    }
    enterTimerRef.current = window.setTimeout(() => onEnterRef.current(), 520);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') enterWorkspace();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    };
  }, [enterWorkspace]);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 18;
    const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.43) * 12;
    setPointer({ x, y, offsetX, offsetY });
  }

  function resetPointer() {
    setPointer({ x: 50, y: 43, offsetX: 0, offsetY: 0 });
  }

  const experienceStyle = {
    '--welcome-pointer-x': `${pointer.x}%`,
    '--welcome-pointer-y': `${pointer.y}%`,
    '--welcome-parallax-x': `${pointer.offsetX}px`,
    '--welcome-parallax-y': `${pointer.offsetY}px`,
    '--welcome-parallax-soft-x': `${pointer.offsetX * 0.45}px`,
    '--welcome-parallax-soft-y': `${pointer.offsetY * 0.45}px`,
  } as CSSProperties;

  return (
    <main
      className={`welcome-experience ${theme === 'dark' ? 'is-dark' : 'is-light'} ${leaving ? 'is-leaving' : ''}`}
      style={experienceStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <div className="welcome-noise" aria-hidden="true" />
      <div className="welcome-constellation welcome-constellation-left" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>
      <div className="welcome-constellation welcome-constellation-right" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      <div className="welcome-grid" aria-hidden="true" />
      <div className="welcome-orbit welcome-orbit-one" aria-hidden="true" />
      <div className="welcome-orbit welcome-orbit-two" aria-hidden="true" />
      <div className="welcome-signal-field" aria-hidden="true">
        <span className="welcome-signal-route route-image"><i className="welcome-signal-packet" /></span>
        <span className="welcome-signal-route route-motion"><i className="welcome-signal-packet" /></span>
        <span className="welcome-signal-route route-text"><i className="welcome-signal-packet" /></span>
        <span className="welcome-signal-route route-canvas"><i className="welcome-signal-packet" /></span>
        <div className="welcome-signal-node signal-image">
          <i>01</i>
          <span><strong>IMAGE</strong><small>VISION CORE</small></span>
        </div>
        <div className="welcome-signal-node signal-motion">
          <i>02</i>
          <span><strong>MOTION</strong><small>TIME &amp; SPACE</small></span>
        </div>
        <div className="welcome-signal-node signal-text">
          <i>03</i>
          <span><strong>TEXT</strong><small>IDEA ENGINE</small></span>
        </div>
        <div className="welcome-signal-node signal-canvas">
          <i>04</i>
          <span><strong>CANVAS</strong><small>MAKE IT REAL</small></span>
        </div>
      </div>

      <section className="welcome-stage" aria-labelledby="welcome-title">
        <div className="welcome-kicker">
          <span className="welcome-kicker-line" aria-hidden="true" />
          CREATIVE INTELLIGENCE STUDIO
          <span className="welcome-kicker-line" aria-hidden="true" />
        </div>
        <div className="welcome-mark-wrap">
          <span className="welcome-mark-halo" aria-hidden="true" />
          <span className="welcome-mark-ring" aria-hidden="true" />
          <span className="welcome-mark-crosshair welcome-mark-crosshair-x" aria-hidden="true" />
          <span className="welcome-mark-crosshair welcome-mark-crosshair-y" aria-hidden="true" />
          <span className="welcome-mark">
            <img src="/brand-mark-welcome.png" alt="" />
          </span>
        </div>
        <div className="welcome-core-readout" aria-hidden="true">
          <span className="welcome-core-readout-line" />
          <span>CORE 01</span>
          <strong><i /> ONLINE</strong>
          <span className="welcome-core-readout-line" />
        </div>
        <h1 id="welcome-title">SANMAO<span>.AI</span></h1>
        <p className="welcome-tagline">让想法开始成形</p>
        <p className="welcome-description">
          从灵感到成品，把创意交给一个真正懂你的创作工作台。
        </p>
        <div className="welcome-launch">
          <div className="welcome-launch-top" aria-hidden="true">
            <span>CREATION CORE</span>
            <span className="welcome-launch-ready"><i /> READY</span>
          </div>
          <button type="button" className="welcome-enter" onClick={enterWorkspace} autoFocus>
            <span className="welcome-enter-workbench-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <rect x="4" y="5" width="16" height="14" rx="2.5" />
                <path d="M4 9h16M8 13h3M13 13h3M8 16h6" />
              </svg>
            </span>
            <span className="welcome-enter-copy">
              <strong>进入工作台</strong>
              <small>OPEN STUDIO</small>
            </span>
            <span className="welcome-enter-arrow" aria-hidden="true">↗</span>
          </button>
          <div className="welcome-launch-bottom" aria-hidden="true">
            <span />
            <span>PRESS ENTER</span>
            <span />
          </div>
        </div>
      </section>

      <div className="welcome-footer">
        <span>AI CREATION / 2026</span>
        <span className="welcome-footer-status"><i aria-hidden="true" /> SYSTEM READY</span>
      </div>
    </main>
  );
}

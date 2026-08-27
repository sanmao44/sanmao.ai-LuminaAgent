'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sanmao-motion-preference';
type MotionPreferenceValue = 'auto' | 'on' | 'off';

function applyMotionPreference(value: MotionPreferenceValue) {
  if (value === 'on' || value === 'off') document.documentElement.dataset.motion = value;
  else delete document.documentElement.dataset.motion;
}

function readPreference(): MotionPreferenceValue {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export default function MotionPreference() {
  const [systemReduced, setSystemReduced] = useState(false);
  const [preference, setPreference] = useState<MotionPreferenceValue>('auto');

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const next = readPreference();
    setPreference(next);
    setSystemReduced(Boolean(media?.matches));
    applyMotionPreference(next);

    const onChange = () => setSystemReduced(Boolean(media?.matches));
    media?.addEventListener?.('change', onChange);
    media?.addListener?.(onChange);
    return () => {
      media?.removeEventListener?.('change', onChange);
      media?.removeListener?.(onChange);
    };
  }, []);

  if (!systemReduced || preference !== 'auto') return null;

  function enableMotion() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'on');
    } catch {
      // The in-memory attribute still enables motion for this page session.
    }
    applyMotionPreference('on');
    setPreference('on');
  }

  return (
    <aside className="motion-compat-notice" role="status">
      <span>
        <strong>检测到系统已减少动态效果</strong>
        <small>公司电脑的系统策略可能让画布和加载动画停止。</small>
      </span>
      <button type="button" onClick={enableMotion}>仅为本应用开启</button>
    </aside>
  );
}

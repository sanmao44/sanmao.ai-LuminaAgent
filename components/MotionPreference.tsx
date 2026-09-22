'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'sanmao-motion-preference';
type MotionPreferenceValue = 'on' | 'off';

/**
 * 默认强制开启动态效果：公司统一策略会把 prefers-reduced-motion 设为 reduce，
 * 画布流光、生成进度、欢迎页动画会整体停摆，看起来像卡住或掉帧。
 * 只有用户在本机明确关过（off）时才真的停用动画，系统策略不再覆盖本应用。
 */
function applyMotionPreference(value: MotionPreferenceValue) {
  document.documentElement.dataset.motion = value;
}

function readPreference(): MotionPreferenceValue {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

export default function MotionPreference() {
  useEffect(() => {
    applyMotionPreference(readPreference());
  }, []);

  return null;
}

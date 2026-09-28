'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, Ref, RefObject } from 'react';

/** 与 voiceorbs 共享的七态契约（MIT），颜色与动效参数由项目主题接管。 */
export type AgentOrbState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'disabled';

export type AgentOrbProps = {
  state?: AgentOrbState;
  size?: number;
  speed?: number;
  colorFrom?: string;
  colorTo?: string;
  /** 外接实时音量（0–1）；不传时用状态能量曲线模拟呼吸。 */
  levelRef?: RefObject<number>;
  /** 传空字符串表示纯装饰，读屏软件会忽略它。 */
  label?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
};

const STATE_LABELS: Record<AgentOrbState, string> = {
  idle: '助手空闲',
  connecting: '助手正在连接',
  listening: '助手正在聆听',
  thinking: '助手正在思考',
  speaking: '助手正在回答',
  error: '助手出错了',
  disabled: '助手已停用',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 面板状态 → 球体状态：忙但还没吐字＝思考中，已经出字＝回答中，失败＝错误色。
 * 画布 Agent 面板、画布顶栏和右键菜单共用这一份映射，避免几处状态各说各话。
 */
export function busyOrbState(busy: boolean, streaming = false, failed = false): AgentOrbState {
  if (busy) return streaming ? 'speaking' : 'thinking';
  return failed ? 'error' : 'idle';
}

/** 没有麦克风输入时，用状态能量曲线驱动呼吸，避免球体死板。 */
function stateEnergy(state: AgentOrbState, t: number): number {
  switch (state) {
    case 'listening':
      return 0.4 + 0.32 * Math.abs(Math.sin(t * 8.5)) + 0.18 * Math.abs(Math.sin(t * 4.1 + 1.5));
    case 'speaking':
      return 0.3 + 0.24 * Math.abs(Math.sin(t * 6.2)) + 0.16 * Math.abs(Math.sin(t * 3 + 0.6));
    case 'thinking':
      return 0.24 + 0.2 * Math.abs(Math.sin(t * 2.4));
    case 'connecting':
      return 0.12 + 0.1 * Math.abs(Math.sin(t * 1.6));
    case 'error':
      return 0.2;
    default:
      return 0;
  }
}

const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

const prefersStillness = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off';

/** 逐帧刷新 --aorb-level：离屏、切到后台或用户关掉动效时自动停下。 */
function useOrbLevel(ref: RefObject<HTMLDivElement | null>, state: AgentOrbState, levelRef?: RefObject<number>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let last: number | null = null;
    let clock = 0;
    let smoothed = 0;
    let inView = true;
    let enabled = !prefersStillness();

    const reset = () => {
      el.style.setProperty('--aorb-level', '0');
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      clock += dt;
      const live = levelRef?.current;
      const target = typeof live === 'number' && live >= 0 ? live : stateEnergy(state, clock);
      smoothed = approach(smoothed, clamp01(target), 7.7, dt);
      el.style.setProperty('--aorb-level', smoothed.toFixed(3));
      if (enabled && inView) raf = requestAnimationFrame(frame);
      else last = null;
    };

    const wake = () => {
      if (!enabled || !inView) return;
      if (raf === 0) raf = requestAnimationFrame(frame);
    };

    const halt = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      last = null;
    };

    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inView = entries.some((entry) => entry.isIntersecting);
          if (inView) wake();
          else halt();
        })
      : null;
    observer?.observe(el);

    const onVisibility = () => {
      if (document.hidden) halt();
      else wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 设置里切换「动态效果」时立刻生效，不必等下次挂载。
    const motionObserver = new MutationObserver(() => {
      enabled = !prefersStillness();
      if (enabled) wake();
      else {
        halt();
        reset();
      }
    });
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });

    if (enabled) wake();
    else reset();

    return () => {
      halt();
      observer?.disconnect();
      motionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ref, state, levelRef]);
}

export default function AgentOrb({
  state = 'idle',
  size,
  speed = 1,
  colorFrom,
  colorTo,
  levelRef,
  label,
  className,
  ref,
}: AgentOrbProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useOrbLevel(innerRef, state, levelRef);

  const decorative = label === '';
  const style = {
    '--aorb-speed': String(speed),
    ...(typeof size === 'number' ? { '--aorb-size': `${size}px` } : null),
    ...(colorFrom ? { '--aorb-color-from': colorFrom } : null),
    ...(colorTo ? { '--aorb-color-to': colorTo } : null),
  } as CSSProperties;

  return (
    <div
      ref={setRef}
      data-state={state}
      className={['agent-orb', className].filter(Boolean).join(' ')}
      style={style}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label ?? STATE_LABELS[state] })}
    >
      <span className="agent-orb-glow" />
      <span className="agent-orb-halo agent-orb-halo-b" />
      <span className="agent-orb-halo agent-orb-halo-a" />
      <span className="agent-orb-disc" />
      <span className="agent-orb-core" />
      <span className="agent-orb-orbit agent-orb-orbit-a" />
      <span className="agent-orb-orbit agent-orb-orbit-b" />
      <span className="agent-orb-sparks" />
    </div>
  );
}

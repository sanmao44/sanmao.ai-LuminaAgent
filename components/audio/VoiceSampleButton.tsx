'use client';

import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { getSpeechVoiceSample } from './voice-samples';

let activeAudio: HTMLAudioElement | null = null;
let activeStop: (() => void) | null = null;

type Props = {
  model: string;
  voice: string;
  providerKey: string;
  compact?: boolean;
  optionAction?: boolean;
};

export default function VoiceSampleButton({ model, voice, providerKey, compact = false, optionAction = false }: Props) {
  const sample = getSpeechVoiceSample(model, voice, providerKey);
  const sampleUrl = sample?.url || '';
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');

  useEffect(() => {
    setStatus('idle');
    return () => {
      playRequestRef.current += 1;
      const audio = audioRef.current;
      if (audio && activeAudio === audio) {
        audio.pause();
        audio.currentTime = 0;
        activeAudio = null;
        activeStop = null;
      }
      audioRef.current = null;
    };
  }, [sampleUrl]);

  if (!sample) {
    return <span className="voice-sample-unavailable" title="当前音色暂无可用样音；不会使用其他音色替代或触发付费生成">暂无样音</span>;
  }
  const sampleTitle = `${sample.note}；试听不消耗额度`;
  function stopCurrent() {
    const previousAudio = activeAudio;
    const previousStop = activeStop;
    activeAudio = null;
    activeStop = null;
    previousAudio?.pause();
    if (previousAudio) previousAudio.currentTime = 0;
    previousStop?.();
  }

  async function toggle(event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    let audio = audioRef.current;
    if (!audio) {
      const createdAudio = new Audio(sampleUrl);
      createdAudio.preload = 'metadata';
      createdAudio.addEventListener('playing', () => {
        if (activeAudio === createdAudio) setStatus('playing');
      });
      createdAudio.addEventListener('pause', () => {
        if (activeAudio === createdAudio) setStatus('idle');
      });
      createdAudio.addEventListener('error', () => {
        if (activeAudio === createdAudio) {
          activeAudio = null;
          activeStop = null;
          audioRef.current = null;
          setStatus('error');
        }
      });
      createdAudio.addEventListener('ended', () => {
        if (activeAudio !== createdAudio) return;
        activeAudio = null;
        activeStop = null;
        createdAudio.currentTime = 0;
        setStatus('idle');
      });
      audio = createdAudio;
      audioRef.current = createdAudio;
    }
    if (activeAudio === audio && !audio.paused) {
      activeAudio = null;
      activeStop = null;
      audio.pause();
      audio.currentTime = 0;
      setStatus('idle');
      return;
    }
    stopCurrent();
    if (audio.ended) audio.currentTime = 0;
    activeAudio = audio;
    activeStop = () => setStatus('idle');
    setStatus('loading');
    const playRequest = ++playRequestRef.current;
    try {
      await audio.play();
    } catch {
      if (playRequestRef.current === playRequest && activeAudio === audio) {
        activeAudio = null;
        activeStop = null;
        audioRef.current = null;
        setStatus('error');
      }
    }
  }

  const playing = status === 'playing';
  const label = playing ? '暂停样音' : status === 'error' ? '重试样音' : '播放样音';
  if (optionAction) {
    return <span
      className={`voice-sample-button voice-sample-option-action${playing ? ' playing' : ''}${status === 'error' ? ' error' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={`${label} · ${sampleTitle}`}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => void toggle(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') void toggle(event);
      }}
    >{playing ? '暂停' : status === 'error' ? '重试' : status === 'loading' ? '加载中' : '试听'}</span>;
  }
  return <button type="button" className={`voice-sample-button${compact ? ' compact' : ''}${playing ? ' playing' : ''}${status === 'error' ? ' error' : ''}`} onClick={(event) => void toggle(event)} title={status === 'error' ? '样音加载失败，请检查网络或样音资源后重试；不会调用付费生成' : `${label} · ${sampleTitle}`} disabled={status === 'loading'}>{playing ? '暂停样音' : status === 'error' ? '重试样音' : status === 'loading' ? '加载中' : '播放样音'}</button>;
}

export { SAMPLE_TEXT as SPEECH_SAMPLE_TEXT } from './voice-samples';

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
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
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
    return <span className="voice-sample-unavailable" title="当前模型与服务商暂无对应样音">暂无样音</span>;
  }
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
        if (activeAudio === createdAudio) setPlaying(true);
      });
      createdAudio.addEventListener('pause', () => {
        if (activeAudio === createdAudio) setPlaying(false);
      });
      createdAudio.addEventListener('ended', () => {
        if (activeAudio !== createdAudio) return;
        activeAudio = null;
        activeStop = null;
        createdAudio.currentTime = 0;
        setPlaying(false);
      });
      audio = createdAudio;
      audioRef.current = createdAudio;
    }
    if (activeAudio === audio && !audio.paused) {
      activeAudio = null;
      activeStop = null;
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      return;
    }
    stopCurrent();
    if (audio.ended) audio.currentTime = 0;
    activeAudio = audio;
    activeStop = () => setPlaying(false);
    const playRequest = ++playRequestRef.current;
    try {
      await audio.play();
    } catch {
      if (playRequestRef.current === playRequest && activeAudio === audio) {
        activeAudio = null;
        activeStop = null;
        setPlaying(false);
      }
    }
  }

  const label = playing ? '暂停样音' : '播放样音';
  if (optionAction) {
    return <span
      className={`voice-sample-button voice-sample-option-action${playing ? ' playing' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={`${label}（不消耗额度）`}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => void toggle(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') void toggle(event);
      }}
    >{playing ? '暂停' : '试听'}</span>;
  }
  return <button type="button" className={`voice-sample-button${compact ? ' compact' : ''}${playing ? ' playing' : ''}`} onClick={(event) => void toggle(event)} title={`${label}（不消耗额度）`}>{playing ? '暂停样音' : '播放样音'}</button>;
}

export { SAMPLE_TEXT as SPEECH_SAMPLE_TEXT } from './voice-samples';

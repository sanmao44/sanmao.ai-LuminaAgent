'use client';

import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { getSpeechVoiceSample } from './voice-samples';

let activeAudio: HTMLAudioElement | null = null;
let activeStop: (() => void) | null = null;

type Props = {
  model: string;
  voice: string;
  compact?: boolean;
  optionAction?: boolean;
};

export default function VoiceSampleButton({ model, voice, compact = false, optionAction = false }: Props) {
  const sample = getSpeechVoiceSample(model, voice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {
    if (audioRef.current && activeAudio === audioRef.current) {
      audioRef.current.pause();
      activeAudio = null;
      activeStop?.();
      activeStop = null;
    }
  }, []);

  if (!sample) {
    return <span className="voice-sample-unavailable" title="当前音色暂无通用样音">暂无样音</span>;
  }
  const sampleUrl = sample.url;

  function stopCurrent() {
    activeAudio?.pause();
    if (activeAudio) activeAudio.currentTime = 0;
    activeStop?.();
    activeAudio = null;
    activeStop = null;
  }

  async function toggle(event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(sampleUrl);
      audio.preload = 'metadata';
      audio.addEventListener('ended', () => setPlaying(false));
      audioRef.current = audio;
    }
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      if (activeAudio === audio) {
        activeAudio = null;
        activeStop = null;
      }
      return;
    }
    stopCurrent();
    activeAudio = audio;
    activeStop = () => setPlaying(false);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      if (activeAudio === audio) {
        activeAudio = null;
        activeStop = null;
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

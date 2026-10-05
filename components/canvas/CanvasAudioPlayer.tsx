"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

function formatCanvasAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export default function CanvasAudioPlayer({
  src,
  name,
  compact = false,
  autoPlay = false,
  onDuration,
}: {
  src: string;
  name?: string;
  compact?: boolean;
  autoPlay?: boolean;
  onDuration?: (durationSeconds: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlayback = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
    }
  };

  return (
    <div
      className={`canvas-audio-player${compact ? " compact" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        aria-label={`音频播放器${name ? `：${name}` : ""}`}
        className="canvas-audio-player-native"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
          setDuration(nextDuration);
          onDuration?.(nextDuration);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setPlaying(false)}
      />
      <button
        type="button"
        className="canvas-audio-player-play"
        aria-label={playing ? "暂停音频" : "播放音频"}
        title={playing ? "暂停" : "播放"}
        onClick={togglePlayback}
      >
        <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
      </button>
      <div className="canvas-audio-player-track">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(currentTime, duration || 0)}
          aria-label="音频播放进度"
          disabled={!duration}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            if (!audioRef.current || !Number.isFinite(nextTime)) return;
            audioRef.current.currentTime = nextTime;
            setCurrentTime(nextTime);
          }}
        />
        <div className="canvas-audio-player-time" aria-live="off">
          <span>{formatCanvasAudioTime(currentTime)}</span>
          <span>{duration ? formatCanvasAudioTime(duration) : "--:--"}</span>
        </div>
      </div>
      {!compact && (
        <label className="canvas-audio-player-volume" title="音量">
          <span aria-hidden="true">◖</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            aria-label="音量"
            onChange={(event) => {
              const nextVolume = Number(event.target.value);
              setVolume(nextVolume);
              if (audioRef.current) audioRef.current.volume = nextVolume;
            }}
          />
        </label>
      )}
    </div>
  );
}

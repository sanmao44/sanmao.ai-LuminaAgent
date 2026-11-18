'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GenerationLog } from '@/lib/generation-log';
import { generationLogSourceLabel, generationLogTitle } from '@/lib/generation-log-presentation';
import GenerationModelBadge from './GenerationModelBadge';
import './GenerationLogAudio.css';

type AudioPlayerProps = {
  src: string;
  title?: string;
  fileName?: string;
  downloadable?: boolean;
  onMetadata?: (audio: HTMLAudioElement) => void;
};

export function GenerationLogAudioPlayer({ src, title, fileName: requestedFileName, downloadable = true, onMetadata }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackError, setPlaybackError] = useState('');
  const fileName = requestedFileName || audioFileName(src);
  const isPcm = fileName.toLowerCase().endsWith('.pcm');
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, currentTime / duration * 100)) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError('');
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setPlaybackError('');
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
        setPlaybackError('音频暂时无法播放，请检查格式或网络后重试。');
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(value: string) {
    const audio = audioRef.current;
    const nextTime = Number(value);
    if (!audio || !Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  return (
    <div className={`generation-log-audio${downloadable ? '' : ' generation-log-audio-preview'}`}>
      {title && <span className="generation-log-audio-title">{title}</span>}
      {isPcm
        ? <span className="generation-log-audio-note">PCM 音频请下载后使用音频编辑软件播放。</span>
        : <div className="generation-log-audio-controls">
          <audio
            ref={audioRef}
            preload="metadata"
            src={src}
            onLoadedMetadata={(event) => {
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              onMetadata?.(event.currentTarget);
            }}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setCurrentTime(0); }}
            onError={() => {
              setPlaying(false);
              setPlaybackError('音频加载失败，请检查文件或网络后重试。');
            }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            className="generation-log-audio-play"
            onClick={() => void togglePlayback()}
            aria-label={playing ? '暂停音频' : '播放音频'}
            title={playing ? '暂停' : '播放'}
          >
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          </button>
          <span className="generation-log-audio-time" aria-label={`当前时间 ${formatAudioTime(currentTime)}，总时长 ${formatAudioTime(duration)}`}>
            {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
          </span>
          <input
            className="generation-log-audio-seek"
            style={{ '--progress': `${progressPercent}%` } as CSSProperties}
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(event.currentTarget.value)}
            disabled={!duration}
            aria-label="音频播放进度"
          />
          <label className="generation-log-audio-volume" title="音量">
            <span aria-hidden="true">◖</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => {
                const nextVolume = Number(event.currentTarget.value);
                setVolume(nextVolume);
                if (audioRef.current) audioRef.current.volume = nextVolume;
              }}
              aria-label="音量"
            />
          </label>
        </div>}
      {playbackError && !isPcm && <span className="generation-log-audio-error" role="status">{playbackError}</span>}
      {downloadable && <a href={src} download={fileName} className="generation-log-audio-download">下载音频</a>}
    </div>
  );
}

export function GenerationLogAudioWorks({ logs }: { logs: readonly GenerationLog[] }) {
  if (!logs.length) return null;

  return (
    <section className="generation-audio-works" aria-label="音频作品">
      <div className="generation-audio-works-heading">
        <div>
          <strong>音频作品</strong>
          <small>已生成的音频可在这里试听和下载</small>
        </div>
        <span>{logs.length} 段</span>
      </div>
      <div className="generation-audio-works-list">
        {logs.map((log) => (
          <article className="generation-audio-work" key={log.id}>
            <div className="generation-audio-work-copy">
              <strong>{generationLogTitle(log)}</strong>
              <small>{generationLogSourceLabel(log)} · <GenerationModelBadge modelId={log.modelId} requestedModelId={log.requestedModelId} modelName={log.modelName} providerName={log.providerName} /> · {new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
            </div>
            <GenerationLogAudioPlayer src={log.audioUrl || ''} />
          </article>
        ))}
      </div>
    </section>
  );
}

function formatAudioTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function audioFileName(src: string) {
  try {
    const url = new URL(src, 'http://sanmao.local');
    const value = url.searchParams.get('name') || decodeURIComponent(url.pathname.split('/').pop() || '');
    if (value && /^[\w.-]{1,180}$/u.test(value)) return value;
  } catch {}
  return 'SANMAO-audio.mp3';
}

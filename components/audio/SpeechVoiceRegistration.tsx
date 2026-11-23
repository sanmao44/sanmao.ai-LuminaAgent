'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechModelProfile } from '@/packages/contracts/audio-synthesis';
import './SpeechVoiceRegistration.css';

type RegisteredVoice = {
  voiceId: string;
  name: string;
  status: string;
  previewUrl?: string;
};

type Props = {
  profile: SpeechModelProfile;
  modelId?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type ApiResponse = {
  error?: unknown;
  resultUnconfirmed?: unknown;
  url?: unknown;
  expiresAt?: unknown;
  voice?: unknown;
  voices?: unknown;
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function registrationModel(profile: SpeechModelProfile) {
  if (profile.publicModel === 'voice-clone-tts') return 'voice-clone-tts';
  if (profile.publicModel === 'minimax-speech-2.8-hd-tts') return 'minimax-speech-2.8-hd-clone';
  if (profile.publicModel === 'minimax-speech-2.8-turbo-tts') return 'minimax-speech-2.8-turbo-clone';
  return '';
}

function responseError(value: ApiResponse, status: number) {
  return typeof value.error === 'string' ? value.error : `请求失败（${status}）`;
}

export function readVoiceRecordingDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (run: () => void) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      URL.revokeObjectURL(source);
      audio.removeAttribute('src');
      audio.load();
      run();
    };
    audio.onloadedmetadata = () => {
      // load() clears metadata synchronously, so capture the duration before disposal.
      const seconds = audio.duration;
      finish(() => resolve(seconds));
    };
    audio.onerror = () => finish(() => reject(new Error('无法读取录音时长，请换用有效的 MP3 或 WAV 文件。')));
    audio.preload = 'metadata';
    audio.src = source;
  });
}

function isAudioFile(file: File, extension: 'mp3' | 'wav' | 'both') {
  const name = file.name.toLowerCase();
  const isMp3 = file.type === 'audio/mpeg' || name.endsWith('.mp3');
  const isWav = ['audio/wav', 'audio/x-wav'].includes(file.type) || name.endsWith('.wav');
  return extension === 'mp3' ? isMp3 : isMp3 || isWav;
}

export default function SpeechVoiceRegistration({ profile, modelId, value, onChange, disabled = false }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const existingVoiceIdsRef = useRef<Set<string>>(new Set());
  const registrationModelId = registrationModel(profile);
  const activeModelId = typeof modelId === 'string' ? modelId : '';
  const isMiniMax = registrationModelId.startsWith('minimax-');
  const formats = isMiniMax ? '.mp3,audio/mpeg' : '.mp3,.wav,audio/mpeg,audio/wav';
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [fileName, setFileName] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [consented, setConsented] = useState(false);
  const [voices, setVoices] = useState<RegisteredVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewingVoiceId, setPreviewingVoiceId] = useState('');
  const [registrationUnconfirmed, setRegistrationUnconfirmed] = useState(false);
  const [retryConfirmationRequired, setRetryConfirmationRequired] = useState(false);
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [unconfirmedVoiceName, setUnconfirmedVoiceName] = useState('');

  const stopPreview = useCallback((updateState = true) => {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    const audio = previewAudioRef.current;
    previewAudioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
    previewBlobUrlRef.current = null;
    if (updateState) setPreviewingVoiceId('');
  }, []);

  useEffect(() => {
    stopPreview();
    setRecordingUrl('');
    setExpiresAt('');
    setFileName('');
    setDuration(null);
    setVoices([]);
    setError('');
    setNotice('');
    setRegistrationUnconfirmed(false);
    setRetryConfirmationRequired(false);
    setRetryConfirmed(false);
    setUnconfirmedVoiceName('');
  }, [activeModelId, registrationModelId, stopPreview]);

  useEffect(() => () => stopPreview(false), [stopPreview]);

  if (!registrationModelId || !activeModelId) return null;

  async function loadVoices() {
    setLoadingVoices(true);
    setError('');
    try {
      const query = new URLSearchParams({ modelId: activeModelId, registrationModel: registrationModelId });
      const response = await fetch(`/api/audio/voices?${query}`, { cache: 'no-store' });
      const result = await response.json() as ApiResponse;
      if (!response.ok || !Array.isArray(result.voices)) throw new Error(responseError(result, response.status));
      const nextVoices = result.voices.filter((item): item is RegisteredVoice => Boolean(item && typeof item === 'object' && typeof (item as RegisteredVoice).voiceId === 'string' && typeof (item as RegisteredVoice).name === 'string'));
      setVoices(nextVoices);
      if (registrationUnconfirmed) {
        const newlyRegistered = nextVoices.find((voice) => voice.name === unconfirmedVoiceName && !existingVoiceIdsRef.current.has(voice.voiceId));
        setRegistrationUnconfirmed(false);
        if (newlyRegistered) {
          onChange(newlyRegistered.voiceId);
          setRetryConfirmationRequired(false);
          setRetryConfirmed(false);
          setUnconfirmedVoiceName('');
          setNotice('已在音色列表中找到刚才登记的音色，并自动选中。');
        } else {
          setRetryConfirmationRequired(true);
          setRetryConfirmed(false);
          setNotice('列表已刷新，但暂未找到刚才提交的音色。确认列表中没有新增记录后，才能重新登记。');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取已登记音色失败。');
    } finally {
      setLoadingVoices(false);
    }
  }

  async function uploadRecording(file: File) {
    setError('');
    setNotice('');
    setRecordingUrl('');
    setExpiresAt('');
    setFileName('');
    setDuration(null);
    if (!isAudioFile(file, isMiniMax ? 'mp3' : 'both')) {
      setError(isMiniMax ? 'MiniMax 克隆登记仅接受 MP3 录音。' : '克隆登记仅接受 MP3 或 WAV 录音。');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('录音不能超过 25 MiB。');
      return;
    }

    setUploading(true);
    try {
      const seconds = await readVoiceRecordingDuration(file);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('无法读取录音时长，请检查文件后重试。');
      if (!isMiniMax && (seconds < 3 || seconds > 60)) throw new Error('通用克隆录音需约 3–60 秒，请调整后重试。');
      const form = new FormData();
      form.set('file', file);
      form.set('kind', 'audio');
      const response = await fetch('/api/cangyuan/media/upload', { method: 'POST', body: form });
      const result = await response.json() as ApiResponse;
      if (!response.ok || typeof result.url !== 'string' || !result.url) throw new Error(responseError(result, response.status));
      setRecordingUrl(result.url);
      setExpiresAt(typeof result.expiresAt === 'string' ? result.expiresAt : '');
      setFileName(file.name);
      setDuration(seconds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '录音上传失败。');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function registerVoice() {
    if (!recordingUrl || !consented || !name.trim() || registrationUnconfirmed || retryConfirmationRequired && !retryConfirmed) return;
    const submittedName = name.trim();
    existingVoiceIdsRef.current = new Set(voices.map((voice) => voice.voiceId));
    setRegistering(true);
    setError('');
    setNotice('');
    setRetryConfirmationRequired(false);
    setRetryConfirmed(false);
    try {
      let response: Response;
      try {
        response = await fetch('/api/audio/voices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: activeModelId, registrationModel: registrationModelId, name: submittedName, url: recordingUrl, consent: true }),
        });
      } catch {
        setRegistrationUnconfirmed(true);
        setUnconfirmedVoiceName(submittedName);
        throw new Error('登记连接中断，结果尚未确认。请先查询音色列表，避免重复登记或扣费。');
      }
      const result = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok) {
        if (result.resultUnconfirmed === true) {
          setRegistrationUnconfirmed(true);
          setUnconfirmedVoiceName(submittedName);
        }
        throw new Error(responseError(result, response.status));
      }
      if (!result.voice || typeof result.voice !== 'object') {
        setRegistrationUnconfirmed(true);
        setUnconfirmedVoiceName(submittedName);
        throw new Error('登记已响应，但返回内容不完整。请先查询音色列表，避免重复登记或扣费。');
      }
      const voice = result.voice as RegisteredVoice;
      if (typeof voice.voiceId !== 'string' || typeof voice.name !== 'string') {
        setRegistrationUnconfirmed(true);
        setUnconfirmedVoiceName(submittedName);
        throw new Error('登记已响应，但缺少音色编号。请先查询音色列表，避免重复登记或扣费。');
      }
      onChange(voice.voiceId);
      setVoices((current) => [voice, ...current.filter((item) => item.voiceId !== voice.voiceId)]);
      setRegistrationUnconfirmed(false);
      setRetryConfirmationRequired(false);
      setRetryConfirmed(false);
      setUnconfirmedVoiceName('');
      setName('');
      setRecordingUrl('');
      setExpiresAt('');
      setFileName('');
      setDuration(null);
      setConsented(false);
      setNotice('登记完成，已选中新音色。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登记请求失败。若结果未确认，请先查询登记列表。');
    } finally {
      setRegistering(false);
    }
  }

  async function togglePreview(voice: RegisteredVoice) {
    if (!voice.previewUrl) return;
    const current = previewAudioRef.current;
    if (previewingVoiceId === voice.voiceId) {
      stopPreview();
      return;
    }
    if (current || previewAbortControllerRef.current) stopPreview();
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    setPreviewingVoiceId(voice.voiceId);
    try {
      setError('');
      const query = new URLSearchParams({ modelId: activeModelId, registrationModel: registrationModelId, previewUrl: voice.previewUrl });
      const response = await fetch(`/api/audio/voices/preview?${query}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as ApiResponse;
        throw new Error(responseError(result, response.status));
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      previewBlobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      previewAudioRef.current = audio;
      const finish = (failed = false) => {
        if (previewAudioRef.current !== audio) return;
        stopPreview();
        if (failed) setError('该音色的官方试听暂时无法播放。');
      };
      audio.onended = () => finish();
      audio.onerror = () => finish(true);
      await audio.play();
    } catch {
      if (controller.signal.aborted) return;
      if (previewAbortControllerRef.current === controller) stopPreview();
      setError('该音色的官方试听暂时无法播放。');
    }
  }

  return (
    <section className="speech-voice-registration" aria-label="克隆音色管理">
      <div className="speech-voice-registration-heading">
        <span>克隆音色</span>
        <button type="button" className="speech-voice-registration-toggle" aria-expanded={expanded} onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && voices.length === 0 && !loadingVoices) void loadVoices();
        }} disabled={disabled || loadingVoices}>
          {expanded ? '收起管理' : '管理音色'}
        </button>
      </div>
      <p className="speech-voice-registration-note">{isMiniMax ? 'MiniMax Speech 2.8 HD 与 Turbo 共用音色编号；通用克隆音色编号仅适用于通用型号。' : '通用克隆音色编号仅适用于通用型号。'}</p>
      {expanded && <div className="speech-voice-registration-body">
        <div className="speech-voice-registration-list-heading">
          <strong>已登记音色</strong>
          <button type="button" className="speech-voice-registration-refresh" onClick={() => void loadVoices()} disabled={disabled || loadingVoices} aria-label="刷新音色列表" title="刷新音色列表">↻</button>
        </div>
        {loadingVoices ? <p className="speech-voice-registration-state" role="status">正在读取音色…</p> : voices.length ? (
          <ul className="speech-voice-registration-list">
            {voices.map((voice) => <li key={voice.voiceId}>
              <button type="button" className={`speech-voice-registration-choice${value === voice.voiceId ? ' is-selected' : ''}`} onClick={() => onChange(voice.voiceId)} title={voice.voiceId}>
                <span><strong>{voice.name}</strong><small>{voice.status === 'active' ? '可用' : voice.status}</small></span>
                <code>{voice.voiceId}</code>
              </button>
              {voice.previewUrl && <button type="button" className="speech-voice-registration-preview" onClick={() => void togglePreview(voice)} aria-label={`${previewingVoiceId === voice.voiceId ? '暂停' : '试听'}音色：${voice.name}`} title={previewingVoiceId === voice.voiceId ? '暂停试听' : '试听官方样音'}>{previewingVoiceId === voice.voiceId ? '暂停' : '试听'}</button>}
            </li>)}
          </ul>
        ) : <p className="speech-voice-registration-state">还没有登记音色。</p>}

        <div className="speech-voice-registration-create">
          <strong>登记新音色</strong>
          <label className="speech-voice-registration-field">
            <span>音色名称</span>
            <input value={name} maxLength={80} disabled={disabled || registering} onChange={(event) => setName(event.target.value)} placeholder="最多 80 个字" />
          </label>
          <div className="speech-voice-registration-field">
            <span>录音素材</span>
            <input ref={fileInputRef} className="speech-voice-registration-file-input" type="file" accept={formats} aria-label="选择克隆音色录音" disabled={disabled || uploading || registering} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadRecording(file);
            }} />
            <button type="button" className="speech-voice-registration-upload" onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading || registering}>
              {uploading ? '正在上传并检查…' : fileName || `选择 ${isMiniMax ? 'MP3' : 'MP3 / WAV'} 录音`}
            </button>
            <small>{isMiniMax ? '仅 MP3；使用公网临时链接登记。' : 'MP3 或 WAV；录音时长约 3–60 秒。'}{duration !== null ? ` · ${duration.toFixed(1)} 秒` : ''}{expiresAt ? ` · 链接有效至 ${new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
          </div>
          <label className="speech-voice-registration-consent">
            <input type="checkbox" checked={consented} disabled={disabled || registering} onChange={(event) => setConsented(event.target.checked)} />
            <span>我本人是录音说话人，或已取得其明确授权。</span>
          </label>
          {isMiniMax && <p className="speech-voice-registration-cost">MiniMax 克隆音色登记 ¥12 / 次。提交后不可撤销，请勿重复提交。</p>}
          {registrationUnconfirmed && <div className="speech-voice-registration-uncertain" role="alert">
            <span>登记结果尚未确认，请先查询列表，暂时不要再次提交。</span>
            <button type="button" onClick={() => void loadVoices()} disabled={disabled || loadingVoices}>{loadingVoices ? '正在查询…' : '查询登记结果'}</button>
          </div>}
          {retryConfirmationRequired && <label className="speech-voice-registration-consent speech-voice-registration-retry-confirm">
            <input type="checkbox" checked={retryConfirmed} disabled={disabled || registering} onChange={(event) => setRetryConfirmed(event.target.checked)} />
            <span>我已确认刷新后的列表没有新增该音色，仍要重新登记。</span>
          </label>}
          <button type="button" className="speech-voice-registration-submit" onClick={() => void registerVoice()} disabled={disabled || uploading || registering || registrationUnconfirmed || retryConfirmationRequired && !retryConfirmed || !recordingUrl || !name.trim() || !consented}>
            {registering ? '正在登记，请勿重复提交…' : registrationUnconfirmed ? '请先查询登记结果' : isMiniMax ? '确认登记 · ¥12' : '免费登记音色'}
          </button>
        </div>
      </div>}
      {notice && <p className="speech-voice-registration-success" role="status">{notice}</p>}
      {error && <p className="speech-voice-registration-error" role="alert">{error}</p>}
    </section>
  );
}
